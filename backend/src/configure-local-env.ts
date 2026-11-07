import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const envPath = resolve(__dirname, '../../.env');

async function configureLocalEnv() {
  let contents = '';
  try { contents = await readFile(envPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  const current = parse(contents);
  const jwtSecret = current.JWT_SECRET;
  const jwtReady = Boolean(jwtSecret && jwtSecret.length >= 32 && !/replace-|your-|placeholder/i.test(jwtSecret));
  const encryptionKey = current.ENCRYPTION_KEY || '';
  const encryptionReady = (() => {
    try { const decoded = Buffer.from(encryptionKey, 'base64'); return decoded.length === 32 && !/replace-|your-|placeholder/i.test(encryptionKey); }
    catch { return false; }
  })();
  const updates: Record<string, string> = {
    NODE_ENV: 'development',
    DEMO_MODE: 'true',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    JWT_SECRET: jwtReady ? jwtSecret! : randomBytes(48).toString('base64url'),
    ENCRYPTION_KEY: encryptionReady ? encryptionKey : randomBytes(32).toString('base64'),
  };
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  for (const [name, value] of Object.entries(updates)) {
    const index = lines.findIndex(line => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line));
    const setting = `${name}="${value}"`;
    if (index >= 0) lines[index] = setting;
    else lines.push(setting);
  }
  await writeFile(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Local environment configured at .env. ${jwtReady ? 'Kept' : 'Generated'} JWT_SECRET; ${encryptionReady ? 'kept' : 'generated'} ENCRYPTION_KEY. SMTP settings were preserved.`);
}

configureLocalEnv().catch(error => { console.error(`Local environment setup failed: ${error.message}`); process.exit(1); });