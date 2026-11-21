import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';

const work = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const version = 'scrypt-v1';
const dummySalt = randomBytes(16).toString('hex');
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const minute = 60 * 1000;
export const day = 24 * 60 * minute;

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function passwordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, work, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await passwordKey(password, salt);
  return [version, salt, key.toString('hex')].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash?: string | null,
): Promise<boolean> {
  const [scheme, salt, digest] = storedHash?.split('$') ?? [];
  const usable = scheme === version && salt?.length === 32 && digest?.length === 128;
  const expected = usable ? Buffer.from(digest, 'hex') : Buffer.alloc(64);
  const actual = await passwordKey(password, usable ? salt : dummySalt);
  return expected.length === actual.length && timingSafeEqual(expected, actual) && usable;
}

// Credential changes and session creation for the same user serialize on this row.
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}
