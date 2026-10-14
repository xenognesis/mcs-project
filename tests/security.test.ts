import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  hasStoredAdminSecret,
  saveAdminSecret,
  verifyAdminPassword,
  isSessionUnlocked,
  setSessionUnlocked,
  tryAutoUnlock
} from '../electron/security';

describe('electron/security', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'lantern-sec-test-'));
    setSessionUnlocked(false);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    setSessionUnlocked(false);
  });

  it('detecta que inicialmente no existe secret', async () => {
    expect(await hasStoredAdminSecret(tempDir)).toBe(false);
  });

  it('guarda el secret y lo valida correctamente con la contraseña', async () => {
    await saveAdminSecret(tempDir, 'miClaveSecreta123');
    expect(await hasStoredAdminSecret(tempDir)).toBe(true);

    // Valida contraseña correcta
    const ok = await verifyAdminPassword(tempDir, 'miClaveSecreta123');
    expect(ok).toBe(true);

    // Rechaza contraseña incorrecta
    const wrong = await verifyAdminPassword(tempDir, 'otraClaveCualquiera');
    expect(wrong).toBe(false);
  });

  it('maneja el estado de la sesión en memoria', async () => {
    expect(isSessionUnlocked()).toBe(false);
    setSessionUnlocked(true);
    expect(isSessionUnlocked()).toBe(true);
    setSessionUnlocked(false);
    expect(isSessionUnlocked()).toBe(false);
  });

  it('tryAutoUnlock desbloquea si la contraseña coincide', async () => {
    await saveAdminSecret(tempDir, 'adminPass');
    expect(isSessionUnlocked()).toBe(false);

    // Con clave incorrecta no desbloquea
    const fail = await tryAutoUnlock(tempDir, 'wrong');
    expect(fail).toBe(false);
    expect(isSessionUnlocked()).toBe(false);

    // Con clave correcta desbloquea
    const success = await tryAutoUnlock(tempDir, 'adminPass');
    expect(success).toBe(true);
    expect(isSessionUnlocked()).toBe(true);
  });
});
