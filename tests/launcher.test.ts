import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureWrapperScript, setWrapperTarget, wrapperCommandLine, wrapperScriptPath, wrapperTargetPath } from '../electron/launcher';

describe('electron/launcher wrapper de GDLauncher', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-launcher-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('escribe un wrapper que reenvía los argumentos y agrega quickPlay', async () => {
    const script = await ensureWrapperScript(root);
    expect(script).toBe(wrapperScriptPath(root));
    const content = await readFile(script, 'utf8');
    expect(content).toContain('%*');
    expect(content).toContain('--quickPlayMultiplayer');
    expect(content).toContain('join-target.txt');
    expect(content).toContain('\r\n');
  });

  it('guarda y limpia la dirección del servidor activo', async () => {
    await setWrapperTarget(root, '26.51.59.94:25565');
    expect(await readFile(wrapperTargetPath(root), 'utf8')).toBe('26.51.59.94:25565');
    await setWrapperTarget(root, null);
    expect(await readFile(wrapperTargetPath(root), 'utf8')).toBe('');
  });

  it('entrecomilla la ruta solo cuando tiene espacios', () => {
    const withSpace = path.join(root, 'con espacio');
    expect(wrapperCommandLine(withSpace)).toBe(`"${wrapperScriptPath(withSpace)}"`);
    expect(wrapperCommandLine(root)).toBe(wrapperScriptPath(root));
  });
});
