import { Pool } from 'pg';
import Redis from 'ioredis';
import { randomUUID, randomInt } from 'node:crypto';
import { encrypt, hash } from './security';
import { Parcel, User, Status, History, priceFor } from './domain';

export const demoUserId = '11111111-1111-4111-8111-111111111111';

export class Store {
  private parcels = new Map<string, Parcel>();
  private users = new Map<string, User>();
  private entries = new Map<string, { value: string; expires: number }>();
  readonly pool?: Pool;
  readonly redis?: Redis;
  constructor(readonly demo: boolean, readonly key: Buffer) {
    if (!demo) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
      this.redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 });
      this.redis.on('error', () => console.error('Redis connection error'));
    }
  }
  async initialize() {
    if (!this.demo) {
      await this.pool!.query('SELECT 1');
      await this.redis!.ping();
      return;
    }
    const cities = ['Warszawa', 'Kraków', 'Wrocław', 'Poznań', 'Gdańsk', 'Łódź', 'Katowice', 'Lublin'];
    const names = ['Anna Kowalska', 'Michał Nowak', 'Julia Wiśniewska', 'Piotr Zieliński', 'Zofia Wójcik', 'Jakub Kamiński', 'Maria Lewandowska', 'Adam Szymański'];
    const streets = ['ul. Dobra 12/4', 'ul. Karmelicka 8', 'ul. Wiosenna 24', 'ul. Polna 6/2', 'ul. Długa 15', 'ul. Piotrkowska 42', 'ul. Lipowa 9', 'ul. Słoneczna 3'];
    const pinHash = await hash('123456');
    for (let index = 0; index < 24; index++) {
      const status: Status = index < 3 ? 'CREATED' : index < 10 ? 'IN_TRANSIT' : index < 15 ? 'OUT_FOR_DELIVERY' : 'DELIVERED';
      const createdAt = new Date(Date.now() - (index % 7) * 86400000 - 3600000 * 5).toISOString();
      const history: History[] = [{ status: 'CREATED', location: 'Warszawa', timestamp: createdAt }];
      if (status !== 'CREATED') history.push({ status: 'IN_TRANSIT', location: 'Sortownia centralna', timestamp: new Date(new Date(createdAt).getTime() + 3600000).toISOString() });
      if (['OUT_FOR_DELIVERY', 'DELIVERED'].includes(status)) history.push({ status: 'OUT_FOR_DELIVERY', location: cities[index % 8], timestamp: new Date(new Date(createdAt).getTime() + 7200000).toISOString() });
      if (status === 'DELIVERED') history.push({ status, location: cities[index % 8], timestamp: new Date(new Date(createdAt).getTime() + 10800000).toISOString() });
      const size = (['M', 'S', 'L'] as const)[index % 3];
      const parcel: Parcel = {
        id: randomUUID(), trackingNumber: `PK${String(202610170001 + index)}`, senderId: demoUserId, courierId: demoUserId,
        recipientName: encrypt(names[index % 8], this.key), recipientPhone: encrypt('+48 500 600 700', this.key),
        recipientEmail: encrypt(`odbiorca${index + 1}@example.test`, this.key),
        recipientAddress: encrypt(streets[index % 8], this.key), city: cities[index % 8], postalCode: '00-001',
        size, weight: [2.4, 0.8, 5.2][index % 3], service: index % 4 === 0 ? 'EXPRESS' : 'STANDARD',
        price: priceFor(size, index % 4 === 0 ? 'EXPRESS' : 'STANDARD'),
        paymentStatus: status === 'CREATED' ? 'UNPAID' : 'PAID',
        paidAt: status === 'CREATED' ? null : createdAt,
        status, pickupCodeHash: pinHash,
        createdAt, estimatedDelivery: new Date(Date.now() + (index % 2) * 86400000).toISOString(), history,
      };
      this.parcels.set(parcel.id, parcel);
    }
  }
  async all(): Promise<Parcel[]> {
    if (this.demo) return [...this.parcels.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    const { rows } = await this.pool!.query('SELECT payload FROM parcels ORDER BY created_at DESC LIMIT 1000');
    return rows.map(row => row.payload as Parcel);
  }
  async find(id: string): Promise<Parcel | undefined> {
    if (this.demo) return [...this.parcels.values()].find(parcel => parcel.id === id || parcel.trackingNumber === id);
    const { rows } = await this.pool!.query('SELECT payload FROM parcels WHERE id::text = $1 OR tracking_number = $1', [id]);
    return rows[0]?.payload;
  }
  async save(parcel: Parcel, changedBy: string) {
    if (this.demo) { this.parcels.set(parcel.id, structuredClone(parcel)); return; }
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO parcels(id,tracking_number,sender_id,courier_id,recipient_name,recipient_phone,recipient_email,recipient_address,city,postal_code,weight,dimensions,status,pickup_code_hash,payment_status,paid_at,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18)', [parcel.id, parcel.trackingNumber, parcel.senderId, parcel.courierId, parcel.recipientName, parcel.recipientPhone, parcel.recipientEmail, parcel.recipientAddress, parcel.city, parcel.postalCode, parcel.weight, JSON.stringify({ size: parcel.size, lockerOrPointId: parcel.lockerOrPointId }), parcel.status, parcel.pickupCodeHash, parcel.paymentStatus, parcel.paidAt, JSON.stringify(parcel), parcel.createdAt]);
      await client.query('INSERT INTO parcel_status_history(parcel_id,status,location,changed_by) VALUES($1,$2,$3,$4)', [parcel.id, parcel.status, parcel.city, changedBy]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async transition(parcel: Parcel, previous: Status, changedBy: string): Promise<boolean> {
    if (this.demo) {
      if (this.parcels.get(parcel.id)?.status !== previous) return false;
      this.parcels.set(parcel.id, structuredClone(parcel)); return true;
    }
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('UPDATE parcels SET status=$1,payload=$2::jsonb,courier_id=$3 WHERE id=$4 AND status=$5', [parcel.status, JSON.stringify(parcel), parcel.courierId, parcel.id, previous]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return false; }
      await client.query('INSERT INTO parcel_status_history(parcel_id,status,location,changed_by) VALUES($1,$2,$3,$4)', [parcel.id, parcel.status, parcel.city, changedBy]);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async markPaid(parcel: Parcel): Promise<boolean> {
    if (this.demo) {
      const current = this.parcels.get(parcel.id);
      if (!current || current.paymentStatus !== 'UNPAID' || current.status !== 'CREATED') return false;
      this.parcels.set(parcel.id, structuredClone(parcel));
      return true;
    }
    const result = await this.pool!.query(
      'UPDATE parcels SET payment_status=$1,paid_at=$2,payload=$3::jsonb WHERE id=$4 AND payment_status=$5 AND status=$6',
      [parcel.paymentStatus, parcel.paidAt, JSON.stringify(parcel), parcel.id, 'UNPAID', 'CREATED'],
    );
    return result.rowCount === 1;
  }
  async user(emailOrId: string): Promise<User | undefined> {
    if (this.demo) return this.users.get(emailOrId);
    const { rows } = await this.pool!.query('SELECT id,email,password_hash AS "passwordHash",role,totp_secret AS "totpSecret",is_2fa_enabled AS "is2faEnabled" FROM users WHERE email=$1 OR id::text=$1', [emailOrId]);
    return rows[0];
  }
  async createUser(input: { email: string; passwordHash: string; role: 'CLIENT' | 'COURIER'; fullName: string; phone?: string; address?: string }) {
    if (this.demo) throw new Error('User provisioning is disabled in demo mode');
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role', [input.email, input.passwordHash, input.role]);
      const user = rows[0];
      await client.query('INSERT INTO user_sensitive_data(user_id,full_name,phone_number,default_address) VALUES($1,$2,$3,$4)', [user.id, encrypt(input.fullName, this.key), input.phone ? encrypt(input.phone, this.key) : null, input.address ? encrypt(input.address, this.key) : null]);
      await client.query('COMMIT');
      return user;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async listUsers(role?: User['role']) {
    if (this.demo) return [];
    const { rows } = role
      ? await this.pool!.query('SELECT id,email,role,is_2fa_enabled AS "is2faEnabled" FROM users WHERE role=$1 ORDER BY email LIMIT 500', [role])
      : await this.pool!.query('SELECT id,email,role,is_2fa_enabled AS "is2faEnabled" FROM users ORDER BY role,email LIMIT 500');
    return rows;
  }
  async setTotp(id: string, secret: string | null, enabled: boolean) {
    await this.pool!.query('UPDATE users SET totp_secret=$1,is_2fa_enabled=$2 WHERE id=$3', [secret, enabled, id]);
  }
  async set(key: string, value: string, seconds: number) {
    if (this.redis) { await this.redis.set(key, value, 'EX', seconds); return; }
    this.entries.set(key, { value, expires: Date.now() + seconds * 1000 });
  }
  async get(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    const entry = this.entries.get(key);
    if (!entry || entry.expires < Date.now()) { this.entries.delete(key); return null; }
    return entry.value;
  }
  async take(key: string): Promise<string | null> {
    if (this.redis) return this.redis.getdel(key);
    const value = await this.get(key); this.entries.delete(key); return value;
  }
  async limit(key: string, max: number, seconds: number): Promise<boolean> {
    if (this.redis) {
      const count = await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `rate:${key}`, seconds) as number;
      return count <= max;
    }
    const slot = Math.floor(Date.now() / (seconds * 1000));
    const name = `rate:${key}:${slot}`;
    const count = Number(await this.get(name) || 0) + 1;
    await this.set(name, String(count), seconds); return count <= max;
  }
  async audit(userId: string, action: string, ip: string) {
    if (!this.demo) await this.pool!.query('INSERT INTO audit_logs(user_id,action,ip_address) VALUES($1,$2,$3)', [userId, action, ip]);
  }
  async auditLogs() {
    if (this.demo) return [];
    return (await this.pool!.query('SELECT id,user_id,action,timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 100')).rows;
  }
  async close() { await this.pool?.end(); await this.redis?.quit(); }
}