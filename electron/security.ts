import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type SecretData = {
  salt: string;
  hash: string;
  updatedAt: string;
};

let sessionUnlocked = false;

function secretPath(driveRoot: string) {
  return path.join(driveRoot, '.lantern', 'admin-secret.json');
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha256').toString('hex');
}

export async function hasStoredAdminSecret(driveRoot: string): Promise<boolean> {
  if (!driveRoot) return false;
  try {
    const raw = await readFile(secretPath(driveRoot), 'utf8');
    const data = JSON.parse(raw) as Partial<SecretData>;
    return Boolean(data.salt && data.hash);
  } catch {
    return false;
  }
}

export async function saveAdminSecret(driveRoot: string, password: string): Promise<void> {
  if (!driveRoot || !password) return;
  const target = secretPath(driveRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const data: SecretData = { salt, hash, updatedAt: new Date().toISOString() };
  await writeFile(target, JSON.stringify(data, null, 2), 'utf8');
}

export async function verifyAdminPassword(driveRoot: string, password: string): Promise<boolean> {
  if (!driveRoot || !password) return false;
  try {
    const raw = await readFile(secretPath(driveRoot), 'utf8');
    const data = JSON.parse(raw) as SecretData;
    if (!data.salt || !data.hash) return false;
    const computed = hashPassword(password, data.salt);
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(data.hash, 'hex'));
  } catch {
    return false;
  }
}

export function isSessionUnlocked(): boolean {
  return sessionUnlocked;
}

export function setSessionUnlocked(unlocked: boolean): void {
  sessionUnlocked = unlocked;
}

export async function tryAutoUnlock(driveRoot: string, localPassword?: string): Promise<boolean> {
  if (sessionUnlocked) return true;
  if (!localPassword) return false;
  const ok = await verifyAdminPassword(driveRoot, localPassword);
  if (ok) sessionUnlocked = true;
  return ok;
}
