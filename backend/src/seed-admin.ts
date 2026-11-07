import { config } from 'dotenv';
import { Pool } from 'pg';
import { hash } from './security';

config({ path: '../.env', quiet: true });
config({ quiet: true });
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!process.env.DATABASE_URL || !email || !password || password.length < 12) {
  throw new Error('Set DATABASE_URL, ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters');
}

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const passwordHash = await hash(password!);
    await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'ADMIN') ON CONFLICT(email) DO NOTHING", [email, passwordHash]);
    console.log(`Admin account ensured for ${email}`);
  } finally { await pool.end(); }
}

seed().catch(error => { console.error(error.message); process.exit(1); });