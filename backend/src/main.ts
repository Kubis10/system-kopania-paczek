import 'reflect-metadata';
import { config } from 'dotenv';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express, Request, Response, NextFunction } from 'express';
import { json } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Secret } from 'otpauth';
import { Store, demoUserId } from './store';
import { Claims, decrypt, encrypt, hash, readToken, signToken, totp, verifyHash, Role } from './security';
import { canTransition, parcelInput, Parcel, priceFor, statuses, User } from './domain';
import { Notifications } from './notifications';

config({ path: '../.env', quiet: true });
config({ quiet: true });
const production = process.env.NODE_ENV === 'production';
const demo = process.env.DEMO_MODE === 'true' || (!production && process.env.DEMO_MODE !== 'false');
if (production && demo) throw new Error('DEMO_MODE must be false in production');
const jwtSecret = process.env.JWT_SECRET || (!production ? randomBytes(48).toString('hex') : '');
const key = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'base64') : !production ? randomBytes(32) : Buffer.alloc(0);
if (jwtSecret.length < 32 || key.length !== 32) throw new Error('Set JWT_SECRET (32+ characters) and ENCRYPTION_KEY (32 bytes, base64)');
if (!demo && (!process.env.DATABASE_URL || !process.env.REDIS_URL)) throw new Error('DATABASE_URL and REDIS_URL are required');
const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const store = new Store(demo, key);
const notifications = new Notifications();
const authUsers = new WeakMap<Request, Claims>();
const fail = (res: Response, status: number, message: string) => res.status(status).json({ message });
const body = <T>(schema: z.ZodType<T>, req: Request) => schema.parse(req.body);
const clientIp = (req: Request) => req.ip || 'unknown';
const authorized = (req: Request) => authUsers.get(req)!;
function access(req: Request, res: Response, next: NextFunction) {
  try { authUsers.set(req, readToken((req.headers.authorization || '').replace(/^Bearer /, ''), jwtSecret, 'access')); next(); }
  catch { fail(res, 401, 'Sesja wygasła. Zaloguj się ponownie.'); }
}
function owns(parcel: Parcel, claims: Claims) {
  return claims.role === 'ADMIN' || (claims.role === 'CLIENT' && parcel.senderId === claims.sub) || (claims.role === 'COURIER' && parcel.courierId === claims.sub && parcel.status === 'OUT_FOR_DELIVERY');
}
function present(parcel: Parcel, revealPii = true) {
  const { pickupCodeHash, senderId, courierId, recipientEmail, ...safe } = parcel;
  return { ...safe,
    recipientName: revealPii ? decrypt(parcel.recipientName, key) : 'Dane odbiorcy po rozpoczęciu doręczenia',
    recipientAddress: revealPii ? decrypt(parcel.recipientAddress, key) : '',
    recipientPhone: revealPii ? '*** *** ' + decrypt(parcel.recipientPhone, key).slice(-3) : '',
  };
}
async function sendNotification(action: () => Promise<void>, trackingNumber: string) {
  if (!notifications.configured) return 'NOT_CONFIGURED' as const;
  try { await action(); return 'SENT' as const; }
  catch { console.error(`Email notification failed for ${trackingNumber}`); return 'FAILED' as const; }
}
async function session(res: Response, user: Pick<User, 'id' | 'role' | 'email'>) {
  const refreshId = randomUUID();
  await store.set(`refresh:${refreshId}`, JSON.stringify(user), 604800);
  const refresh = signToken({ sub: user.id, role: user.role, scope: 'refresh', jti: refreshId }, jwtSecret, 604800);
  res.cookie('refresh_token', refresh, { httpOnly: true, secure: production, sameSite: 'strict', path: '/api/auth', maxAge: 604800000 });
  return res.json({ accessToken: signToken({ sub: user.id, role: user.role, scope: 'access', jti: randomUUID() }, jwtSecret, 900), user: { id: user.id, email: user.email, role: user.role }, demo });
}
class ApiModule {}
Module({})(ApiModule);

async function bootstrap() {
  await store.initialize();
  const app = await NestFactory.create(ApiModule, { logger: ['error', 'warn', 'log'] });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({ origin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '32kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== origin) return fail(res, 403, 'Niedozwolone źródło żądania.');
    next();
  });
  const api: Express = app.getHttpAdapter().getInstance();
  api.use('/api', async (req, res, next) => {
    if (!await store.limit(`api:${clientIp(req)}`, 300, 60)) return fail(res, 429, 'Zbyt wiele zapytań. Spróbuj za minutę.');
    next();
  });
  api.get('/api/health', async (_req, res) => res.json({
    status: 'ok', demo,
    emailConfigured: notifications.configured,
    emailNotifications: await notifications.verify(),
  }));
  api.post('/api/auth/demo', async (req, res) => {
    if (!demo) return fail(res, 404, 'Nie znaleziono.');
    const { role } = body(z.object({ role: z.enum(['CLIENT', 'COURIER', 'ADMIN']).default('CLIENT') }), req);
    return session(res, { id: demoUserId, email: 'aleksandra@demo.przesylka.pl', role });
  });
  api.post('/api/auth/login', async (req, res) => {
    if (!await store.limit(`login:${clientIp(req)}`, 5, 60)) return fail(res, 429, 'Zbyt wiele prób logowania.');
    const input = body(z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }), req);
    const user = await store.user(input.email.toLowerCase());
    const valid = await verifyHash(user?.passwordHash || await hash(randomBytes(32).toString('hex')), input.password);
    if (!user || !valid) return fail(res, 401, 'Nieprawidłowy email lub hasło.');
    if (user.is2faEnabled) {
      const jti = randomUUID();
      await store.set(`pre:${jti}`, user.id, 180);
      return res.json({ requires2fa: true, preAuthToken: signToken({ sub: user.id, role: user.role, scope: 'pre_auth', jti }, jwtSecret, 180) });
    }
    return session(res, user);
  });
  api.post('/api/auth/verify-2fa', async (req, res) => {
    if (!await store.limit(`2fa:${clientIp(req)}`, 5, 180)) return fail(res, 429, 'Zbyt wiele prób weryfikacji.');
    const input = body(z.object({ preAuthToken: z.string().max(2000), code: z.string().regex(/^\d{6}$/) }), req);
    let claims: Claims;
    try { claims = readToken(input.preAuthToken, jwtSecret, 'pre_auth'); } catch { return fail(res, 401, 'Token weryfikacji wygasł.'); }
    const user = await store.user(claims.sub);
    if (!user?.totpSecret || !await store.get(`pre:${claims.jti}`)) return fail(res, 401, 'Nieprawidłowa weryfikacja.');
    const delta = totp(decrypt(user.totpSecret, key)).validate({ token: input.code, window: 1 });
    if (delta === null) return fail(res, 401, 'Nieprawidłowy kod.');
    const step = Math.floor(Date.now() / 30000) + delta;
    if (!await store.limit(`totp-used:${user.id}:${step}`, 1, 90) || !await store.take(`pre:${claims.jti}`)) return fail(res, 401, 'Kod został już wykorzystany.');
    return session(res, user);
  });
  api.post('/api/auth/refresh', async (req, res) => {
    if (req.headers.origin !== origin) return fail(res, 403, 'Wymagany poprawny Origin.');
    try {
      const claims = readToken(req.cookies.refresh_token || '', jwtSecret, 'refresh');
      const user = await store.take(`refresh:${claims.jti}`);
      if (!user) return fail(res, 401, 'Sesja wygasła.');
      return session(res, JSON.parse(user));
    } catch { return fail(res, 401, 'Sesja wygasła.'); }
  });
  api.post('/api/auth/logout', async (req, res) => {
    try { const claims = readToken(req.cookies.refresh_token || '', jwtSecret, 'refresh'); await store.take(`refresh:${claims.jti}`); } catch {}
    res.clearCookie('refresh_token', { path: '/api/auth', httpOnly: true, secure: production, sameSite: 'strict' });
    res.status(204).end();
  });
  api.get('/api/auth/me', access, async (req, res) => {
    const claims = authorized(req);
    const user = await store.user(claims.sub);
    res.json({ ...claims, is2faEnabled: user?.is2faEnabled ?? false, demo });
  });
  api.post('/api/auth/2fa/setup', access, async (req, res) => {
    if (demo) return fail(res, 400, 'Konfiguracja 2FA jest niedostępna w demo.');
    const user = await store.user(authorized(req).sub);
    const { password } = body(z.object({ password: z.string().max(200) }), req);
    if (!user || user.is2faEnabled || !await verifyHash(user.passwordHash, password)) return fail(res, 403, 'Nie można skonfigurować 2FA.');
    const secret = new Secret({ size: 20 }).base32;
    await store.set(`setup:${user.id}`, encrypt(secret, key), 300);
    res.json({ secret, uri: totp(secret).toString() });
  });
  api.post('/api/auth/2fa/enable', access, async (req, res) => {
    if (!await store.limit(`enable:${authorized(req).sub}`, 5, 300)) return fail(res, 429, 'Zbyt wiele prób.');
    const { code } = body(z.object({ code: z.string().regex(/^\d{6}$/) }), req);
    const secret = await store.get(`setup:${authorized(req).sub}`);
    if (!secret || totp(decrypt(secret, key)).validate({ token: code, window: 1 }) === null) return fail(res, 400, 'Nieprawidłowy kod lub konfiguracja wygasła.');
    if (!await store.take(`setup:${authorized(req).sub}`)) return fail(res, 409, 'Konfiguracja została już użyta.');
    await store.setTotp(authorized(req).sub, secret, true);
    res.json({ enabled: true });
  });
  api.post('/api/auth/2fa/disable', access, async (req, res) => {
    if (demo) return fail(res, 400, 'Konfiguracja 2FA jest niedostępna w demo.');
    const claims = authorized(req);
    if (!await store.limit(`totp-disable:${claims.sub}`, 5, 300)) return fail(res, 429, 'Zbyt wiele prób.');
    const input = body(z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/) }), req);
    const user = await store.user(claims.sub);
    if (!user?.is2faEnabled || !user.totpSecret || !await verifyHash(user.passwordHash, input.password)) return fail(res, 403, 'Nie można odłączyć weryfikacji dwuetapowej.');
    const delta = totp(decrypt(user.totpSecret, key)).validate({ token: input.code, window: 1 });
    if (delta === null) return fail(res, 401, 'Nieprawidłowy kod.');
    const step = Math.floor(Date.now() / 30000) + delta;
    if (!await store.limit(`totp-disable-used:${user.id}:${step}`, 1, 90)) return fail(res, 409, 'Kod został już wykorzystany.');
    await store.setTotp(user.id, null, false);
    await store.audit(user.id, '2FA_DISABLE', clientIp(req));
    res.json({ enabled: false });
  });
  api.get('/api/parcels', access, async (req, res) => {
    const claims = authorized(req);
    const parcels = (await store.all()).filter(parcel => owns(parcel, claims) || (claims.role === 'COURIER' && parcel.courierId === claims.sub && parcel.status === 'IN_TRANSIT'));
    await store.audit(authorized(req).sub, 'PARCEL_LIST_PII', clientIp(req));
    res.json(parcels.map(parcel => present(parcel, claims.role !== 'COURIER' || parcel.status === 'OUT_FOR_DELIVERY')));
  });
  api.get('/api/parcels/:id', access, async (req, res) => {
    const parcel = await store.find(String(req.params.id));
    const claims = authorized(req);
    const courierPending = claims.role === 'COURIER' && parcel?.courierId === claims.sub && parcel.status === 'IN_TRANSIT';
    if (!parcel || (!owns(parcel, claims) && !courierPending)) return fail(res, 404, 'Nie znaleziono przesyłki.');
    await store.audit(authorized(req).sub, `PARCEL_READ:${parcel.id}`, clientIp(req));
    res.json(present(parcel, !courierPending));
  });
  api.post('/api/parcels', access, async (req, res) => {
    const claims = authorized(req);
    if (claims.role === 'COURIER') return fail(res, 403, 'Kurier nie może nadawać przesyłek.');
    const input = body(parcelInput, req);
    const pin = String(randomInt(100000, 1000000));
    const now = new Date().toISOString();
    const parcel: Parcel = {
      ...input, id: randomUUID(), trackingNumber: `PK${randomBytes(7).toString('hex').toUpperCase()}`,
      senderId: claims.sub, courierId: null,
      recipientName: encrypt(input.recipientName, key), recipientPhone: encrypt(input.recipientPhone, key),
      recipientEmail: encrypt(input.recipientEmail.toLowerCase(), key),
      recipientAddress: encrypt(input.recipientAddress, key), status: 'CREATED',
      paymentStatus: 'UNPAID', paidAt: null,
      pickupCodeHash: await hash(pin), price: priceFor(input.size, input.service), createdAt: now,
      estimatedDelivery: new Date(Date.now() + (input.service === 'EXPRESS' ? 1 : 2) * 86400000).toISOString(),
      history: [{ status: 'CREATED', location: input.city, timestamp: now }],
    };
    await store.save(parcel, claims.sub);
    await store.audit(claims.sub, `PARCEL_CREATE:${parcel.id}`, clientIp(req));
    const notificationStatus = await sendNotification(() => notifications.parcelCreated({
      email: decrypt(parcel.recipientEmail, key), name: input.recipientName,
      trackingNumber: parcel.trackingNumber, pin, estimatedDelivery: parcel.estimatedDelivery,
    }), parcel.trackingNumber);
    res.status(201).json({ ...present(parcel), ...(demo ? { demoPickupCode: pin } : {}), notificationStatus, paymentMode: 'SIMULATED' });
  });
  api.post('/api/parcels/:id/pay', access, async (req, res) => {
    const claims = authorized(req);
    if (claims.role === 'COURIER') return fail(res, 403, 'Kurier nie może opłacać przesyłek.');
    const parcel = await store.find(String(req.params.id));
    if (!parcel || (claims.role === 'CLIENT' && parcel.senderId !== claims.sub)) return fail(res, 404, 'Nie znaleziono przesyłki.');
    if (parcel.status !== 'CREATED') return fail(res, 409, 'Płatność jest możliwa tylko przed nadaniem.');
    if (parcel.paymentStatus === 'PAID') return res.json({ ...present(parcel), paymentMode: 'SIMULATED' });
    parcel.paymentStatus = 'PAID';
    parcel.paidAt = new Date().toISOString();
    if (!await store.markPaid(parcel)) return fail(res, 409, 'Płatność została już zarejestrowana. Odśwież przesyłkę.');
    await store.audit(claims.sub, `PAYMENT_SIMULATED:${parcel.id}:${parcel.price}`, clientIp(req));
    res.json({ ...present(parcel), paymentMode: 'SIMULATED' });
  });
  api.patch('/api/parcels/:id/status', access, async (req, res) => {
    const claims = authorized(req);
    if (claims.role === 'CLIENT') return fail(res, 403, 'Brak uprawnień.');
    const input = body(z.object({ status: z.enum(statuses), pickupCode: z.string().regex(/^\d{6}$/).optional(), courierId: z.uuid().optional() }), req);
    const found = await store.find(String(req.params.id));
    const courierCanUpdate = claims.role === 'COURIER' && found?.courierId === claims.sub && ((found.status === 'IN_TRANSIT' && input.status === 'OUT_FOR_DELIVERY') || (found.status === 'OUT_FOR_DELIVERY' && input.status === 'DELIVERED'));
    if (!found || (claims.role !== 'ADMIN' && !courierCanUpdate)) return fail(res, 404, 'Nie znaleziono przesyłki.');
    const parcel = structuredClone(found);
    if (!canTransition(parcel.status, input.status)) return fail(res, 409, 'Niedozwolona zmiana statusu.');
    if (input.status !== 'CREATED' && parcel.paymentStatus !== 'PAID') return fail(res, 409, 'Najpierw opłać przesyłkę.');
    if (input.status === 'DELIVERED') {
      if (!await store.limit(`pin:${parcel.id}`, 5, 900)) return fail(res, 429, 'Odbiór zablokowany na 15 minut.');
      if (!input.pickupCode || !await verifyHash(parcel.pickupCodeHash, input.pickupCode)) return fail(res, 400, 'Nieprawidłowy kod odbioru.');
    }
    if (input.status === 'OUT_FOR_DELIVERY') {
      if (claims.role === 'COURIER' && input.courierId && input.courierId !== claims.sub) return fail(res, 403, 'Nie można przypisać przesyłki innemu kurierowi.');
      if (claims.role === 'ADMIN' && !demo && !input.courierId) return fail(res, 400, 'Wskaż poprawne konto kuriera.');
      const courier = demo ? { role: 'COURIER' } : await store.user(input.courierId || '');
      if (courier?.role !== 'COURIER') return fail(res, 400, 'Wskaż poprawne konto kuriera.');
      parcel.courierId = claims.role === 'COURIER' ? claims.sub : demo ? demoUserId : input.courierId!;
    }
    const previous = parcel.status;
    parcel.status = input.status;
    parcel.history.push({ status: input.status, location: parcel.city, timestamp: new Date().toISOString() });
    if (!await store.transition(parcel, previous, claims.sub)) return fail(res, 409, 'Status został zmieniony. Odśwież dane.');
    await store.audit(claims.sub, `STATUS:${parcel.id}:${input.status}`, clientIp(req));
    const notificationStatus = await sendNotification(() => notifications.statusChanged({
      email: decrypt(parcel.recipientEmail, key), name: decrypt(parcel.recipientName, key),
      trackingNumber: parcel.trackingNumber, status: parcel.status,
    }), parcel.trackingNumber);
    res.json({ ...present(parcel), notificationStatus });
  });
  api.get('/api/track/:number', async (req, res) => {
    if (!await store.limit(`track:${clientIp(req)}`, 30, 60)) return fail(res, 429, 'Zbyt wiele zapytań.');
    const number = z.string().regex(/^PK[A-Z0-9]{10,20}$/).parse(req.params.number);
    const parcel = await store.find(number);
    if (!parcel) return fail(res, 404, 'Nie znaleziono przesyłki o tym numerze.');
    res.json({ trackingNumber: parcel.trackingNumber, city: parcel.city, status: parcel.status, estimatedDelivery: parcel.estimatedDelivery, history: parcel.history });
  });
  api.get('/api/admin/audit', access, async (req, res) => {
    if (authorized(req).role !== 'ADMIN') return fail(res, 403, 'Brak uprawnień.');
    res.json(await store.auditLogs());
  });
  api.get('/api/admin/users', access, async (req, res) => {
    if (authorized(req).role !== 'ADMIN' || demo) return fail(res, 403, 'Brak uprawnień.');
    const role = z.enum(['CLIENT', 'COURIER', 'ADMIN']).optional().safeParse(req.query.role);
    if (!role.success) return fail(res, 400, 'Nieprawidłowa rola użytkownika.');
    res.json(await store.listUsers(role.data));
  });
  api.post('/api/admin/users', access, async (req, res) => {
    if (authorized(req).role !== 'ADMIN' || demo) return fail(res, 403, 'Brak uprawnień.');
    if (!await store.limit(`user-provision:${authorized(req).sub}`, 10, 3600)) return fail(res, 429, 'Limit tworzenia kont został osiągnięty.');
    const input = body(z.object({
      email: z.email().max(254), password: z.string().min(12).max(200),
      role: z.enum(['CLIENT', 'COURIER']), fullName: z.string().trim().min(3).max(120),
      phone: z.string().regex(/^\+?[0-9 ()-]{9,20}$/).optional(),
      address: z.string().trim().min(5).max(240).optional(),
    }), req);
    try {
      const user = await store.createUser({ ...input, email: input.email.toLowerCase(), passwordHash: await hash(input.password) });
      await store.audit(authorized(req).sub, `USER_CREATE:${user.id}:${user.role}`, clientIp(req));
      res.status(201).json(user);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return fail(res, 409, 'Konto z tym adresem email już istnieje.');
      throw error;
    }
  });
  api.use('/api', (_req, res) => fail(res, 404, 'Nie znaleziono endpointu.'));
  api.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Sprawdź poprawność danych.', fields: error.flatten() });
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    fail(res, 500, 'Wystąpił błąd serwera. Spróbuj ponownie.');
  });
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
  console.log(`Courier API on :${process.env.PORT || 4000}; demo=${demo}`);
  const shutdown = async () => { await app.close(); await store.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
bootstrap().catch(error => { console.error(error.message); process.exit(1); });