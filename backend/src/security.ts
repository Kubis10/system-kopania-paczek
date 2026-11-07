import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { TOTP, Secret } from 'otpauth';

export type Role = 'CLIENT' | 'COURIER' | 'ADMIN';
export type Claims = { sub: string; role: Role; scope: 'access' | 'pre_auth' | 'refresh'; jti: string };

export function encrypt(value: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decrypt(value: string, key: Buffer): string {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}

export const hash = (value: string) => argon2.hash(value, { type: argon2.argon2id });
export const verifyHash = (encoded: string, value: string) => argon2.verify(encoded, value);

export function signToken(claims: Claims, secret: string, seconds: number): string {
  return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: seconds, issuer: 'przesylka-api', audience: 'przesylka' });
}

export function readToken(token: string, secret: string, scope: Claims['scope']): Claims {
  const claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'przesylka-api', audience: 'przesylka' }) as Claims;
  if (claims.scope !== scope || !claims.sub || !claims.jti || !['CLIENT', 'COURIER', 'ADMIN'].includes(claims.role)) throw new Error('Invalid token scope');
  return claims;
}

export function totp(secret: string) {
  return new TOTP({ issuer: 'Przesylka', label: 'Konto', algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function safeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}