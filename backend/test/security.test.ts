import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, hash, verifyHash, signToken, readToken, totp } from '../src/security';
import { canTransition, parcelInput, priceFor } from '../src/domain';
import { Store, demoUserId } from '../src/store';
import { Secret } from 'otpauth';

test('AES-256-GCM: random nonce, round-trip and tamper rejection', () => {
  const key = randomBytes(32);
  const first = encrypt('ul. Dobra 12', key);
  assert.equal(decrypt(first, key), 'ul. Dobra 12');
  assert.notEqual(first, encrypt('ul. Dobra 12', key));
  const modified = Buffer.from(first, 'base64'); modified[30] ^= 1;
  assert.throws(() => decrypt(modified.toString('base64'), key));
  assert.throws(() => decrypt(first, randomBytes(32)));
});
test('Argon2id verifies passwords and rejects incorrect pickup codes', async () => {
  const encoded = await hash('123456');
  assert.ok(encoded.startsWith('$argon2id$'));
  assert.equal(await verifyHash(encoded, '123456'), true);
  assert.equal(await verifyHash(encoded, '123457'), false);
});
test('Pre-authentication and refresh tokens cannot authorize access', () => {
  const secret = randomBytes(48).toString('hex');
  for (const scope of ['pre_auth', 'refresh'] as const) {
    const token = signToken({ sub: demoUserId, role: 'CLIENT', scope, jti: 'test' }, secret, 180);
    assert.throws(() => readToken(token, secret, 'access'));
  }
  const expired = signToken({ sub: demoUserId, role: 'CLIENT', scope: 'access', jti: 'test' }, secret, -1);
  assert.throws(() => readToken(expired, secret, 'access'));
});
test('TOTP authenticator URIs contain a valid secret and verify generated codes', () => {
  const secret = new Secret({ size: 20 }).base32;
  const authenticator = totp(secret);
  const uri = authenticator.toString();
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.equal(new URL(uri).searchParams.get('secret'), secret);
  assert.equal(authenticator.validate({ token: authenticator.generate(), window: 1 }), 0);
});
test('Parcel transitions are sequential; pricing uses integer grosze', () => {
  assert.ok(canTransition('CREATED', 'IN_TRANSIT'));
  assert.ok(canTransition('OUT_FOR_DELIVERY', 'DELIVERED'));
  assert.equal(canTransition('CREATED', 'DELIVERED'), false);
  assert.equal(canTransition('DELIVERED', 'CREATED'), false);
  assert.equal(priceFor('M', 'EXPRESS'), 2890);
  assert.equal(parcelInput.safeParse({ weight: -1 }).success, false);
  assert.equal(parcelInput.safeParse({
    recipientName: 'Anna Nowak', recipientPhone: '+48 500 600 700',
    recipientEmail: 'anna@example.com', recipientAddress: 'ul. Dobra 12',
    city: 'Warszawa', postalCode: '00-001', size: 'M', weight: 1,
    service: 'STANDARD',
  }).success, true);
  assert.equal(parcelInput.safeParse({
    recipientName: 'Anna Nowak', recipientPhone: '+48 500 600 700',
    recipientEmail: 'not-an-email', recipientAddress: 'ul. Dobra 12',
    city: 'Warszawa', postalCode: '00-001', size: 'M', weight: 1,
    service: 'STANDARD',
  }).success, false);
});
test('One-time session values are consumed and rate limits enforce attempt budget', async () => {
  const store = new Store(true, randomBytes(32));
  await store.set('session', 'user', 60);
  assert.equal(await store.take('session'), 'user');
  assert.equal(await store.take('session'), null);
  assert.equal(await store.limit('pin', 2, 60), true);
  assert.equal(await store.limit('pin', 2, 60), true);
  assert.equal(await store.limit('pin', 2, 60), false);
});
test('Simulated parcel payment is recorded once without charging a provider', async () => {
  const store = new Store(true, randomBytes(32));
  await store.initialize();
  const parcel = (await store.all()).find(item => item.status === 'CREATED');
  assert.ok(parcel);
  assert.equal(parcel.paymentStatus, 'UNPAID');
  const payment = structuredClone(parcel);
  payment.paymentStatus = 'PAID';
  payment.paidAt = new Date().toISOString();
  assert.equal(await store.markPaid(payment), true);
  assert.equal(await store.markPaid(payment), false);
  const saved = await store.find(parcel.id);
  assert.equal(saved?.paymentStatus, 'PAID');
  assert.equal(saved?.paidAt, payment.paidAt);
});