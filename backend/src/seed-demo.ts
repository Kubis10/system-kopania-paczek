import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { encrypt, hash } from './security';
import { History, Parcel, Status, priceFor } from './domain';

config({ path: '../.env', quiet: true });
config({ quiet: true });

if (process.env.NODE_ENV !== 'development' || process.env.DEMO_MODE !== 'false') {
  throw new Error('Demo seed is allowed only for the development database');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
if (encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY must contain 32 base64-decoded bytes');
const initialPassword = process.env.DEMO_SEED_PASSWORD || 'StudentDemo2026!';
if (initialPassword.length < 12) throw new Error('DEMO_SEED_PASSWORD must be at least 12 characters');

async function ensureAccount(
  client: PoolClient,
  input: { email: string; name: string; role: 'CLIENT' | 'COURIER'; phone: string },
  passwordHash: string,
) {
  const inserted = await client.query(
    'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email,role',
    [input.email, passwordHash, input.role],
  );
  const user = inserted.rows[0] || (await client.query(
    'SELECT id,email,role FROM users WHERE email=$1', [input.email],
  )).rows[0];
  if (!user || user.role !== input.role) throw new Error(`Seed email is already used by another role: ${input.email}`);
  if (inserted.rowCount) {
    await client.query(
      'INSERT INTO user_sensitive_data(user_id,full_name,phone_number,default_address) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING',
      [user.id, encrypt(input.name, encryptionKey), encrypt(input.phone, encryptionKey), null],
    );
  }
  return user;
}

async function seedDemo() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let newParcels = 0;
  try {
    await client.query('BEGIN');
    const accountHash = await hash(initialPassword);
    const pickupCodeHash = await hash('123456');
    const sender = await ensureAccount(client, {
      email: 'klient@localhost.test', name: 'Alicja Nowak', role: 'CLIENT', phone: '+48 500 600 101',
    }, accountHash);
    const courier = await ensureAccount(client, {
      email: 'kurier@localhost.test', name: 'Marek Kowalski', role: 'COURIER', phone: '+48 500 600 102',
    }, accountHash);
    const cities = ['Warszawa', 'Kraków', 'Wrocław', 'Poznań', 'Gdańsk', 'Łódź', 'Lublin', 'Katowice'];
    const names = ['Anna Kowalska', 'Michał Nowak', 'Julia Wiśniewska', 'Piotr Zieliński', 'Zofia Wójcik', 'Jakub Kamiński', 'Maria Lewandowska', 'Adam Szymański'];
    const streets = ['ul. Dobra 12/4', 'ul. Karmelicka 8', 'ul. Wiosenna 24', 'ul. Polna 6/2', 'ul. Długa 15', 'ul. Piotrkowska 42', 'ul. Lipowa 9', 'ul. Słoneczna 3'];
    const demoStatuses: Status[] = [
      'CREATED', 'CREATED',
      'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT',
      'OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY',
      'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED',
    ];
    for (let index = 0; index < demoStatuses.length; index++) {
      const status = demoStatuses[index];
      const city = cities[index % cities.length];
      const createdAt = new Date(Date.now() - (index % 8) * 86400000 - 3600000 * 4).toISOString();
      const size = (['S', 'M', 'L'] as const)[index % 3];
      const service = index % 4 === 0 ? 'EXPRESS' : 'STANDARD';
      const history: History[] = [{ status: 'CREATED', location: 'Warszawa', timestamp: createdAt }];
      if (status !== 'CREATED') history.push({ status: 'IN_TRANSIT', location: 'Sortownia centralna', timestamp: new Date(new Date(createdAt).getTime() + 3600000).toISOString() });
      if (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED') history.push({ status: 'OUT_FOR_DELIVERY', location: city, timestamp: new Date(new Date(createdAt).getTime() + 7200000).toISOString() });
      if (status === 'DELIVERED') history.push({ status, location: city, timestamp: new Date(new Date(createdAt).getTime() + 10800000).toISOString() });
      const paymentStatus = status === 'CREATED' ? 'UNPAID' : 'PAID';
      const paidAt = paymentStatus === 'PAID' ? createdAt : null;
      const parcel: Parcel = {
        id: randomUUID(), trackingNumber: `PKSTUD${String(index + 1).padStart(6, '0')}`,
        senderId: sender.id, courierId: status === 'CREATED' ? null : courier.id,
        recipientName: encrypt(names[index % names.length], encryptionKey),
        recipientPhone: encrypt('+48 500 600 700', encryptionKey),
        recipientEmail: encrypt(`odbiorca${index + 1}@example.test`, encryptionKey),
        recipientAddress: encrypt(streets[index % streets.length], encryptionKey),
        city, postalCode: `0${index % 9}-00${String(index % 9)}`,
        size, weight: [0.8, 2.4, 5.2][index % 3], service,
        price: priceFor(size, service), paymentStatus, paidAt, status,
        pickupCodeHash, createdAt,
        estimatedDelivery: new Date(Date.now() + ((index % 2) + 1) * 86400000).toISOString(),
        history,
      };
      const inserted = await client.query(
        'INSERT INTO parcels(id,tracking_number,sender_id,courier_id,recipient_name,recipient_phone,recipient_email,recipient_address,city,postal_code,weight,dimensions,status,pickup_code_hash,payment_status,paid_at,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18) ON CONFLICT(tracking_number) DO NOTHING RETURNING id',
        [parcel.id, parcel.trackingNumber, parcel.senderId, parcel.courierId, parcel.recipientName, parcel.recipientPhone, parcel.recipientEmail, parcel.recipientAddress, parcel.city, parcel.postalCode, parcel.weight, JSON.stringify({ size }), parcel.status, parcel.pickupCodeHash, parcel.paymentStatus, parcel.paidAt, JSON.stringify(parcel), parcel.createdAt],
      );
      if (!inserted.rowCount) continue;
      newParcels++;
      for (const event of history) {
        const changedBy = event.status === 'CREATED' ? sender.id : courier.id;
        await client.query(
          'INSERT INTO parcel_status_history(parcel_id,status,location,changed_by,timestamp) VALUES($1,$2,$3,$4,$5)',
          [parcel.id, event.status, event.location, changedBy, event.timestamp],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`Seeded demo accounts and ${newParcels} new sample parcels. Existing records were kept.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemo().catch(error => { console.error(`Demo seed failed: ${error.message}`); process.exit(1); });