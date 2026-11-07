import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

config({ path: '../.env', quiet: true });
config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const version of ['001_initial', '002_parcel_email', '003_fake_payments']) {
      await client.query('BEGIN');
      const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (alreadyApplied.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      const sql = await readFile(join(__dirname, `../migrations/${version}.sql`), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied migration ${version}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(error => { console.error(error.message); process.exit(1); });