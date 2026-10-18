import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bindToRadminIp } from '../electron/server';
import type { AppConfig } from '../electron/types';

describe('electron/server bindToRadminIp', () => {
  let root: string;
  let file: string;
  const config = () => ({ driveRoot: root }) as AppConfig;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-server-test-'));
    file = path.join(root, 'server.properties');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reemplaza un server-ip del host anterior por la IP actual', async () => {
    await writeFile(file, 'server-port=25565\nserver-ip=26.27.250.137\nmotd=Hola\n', 'utf8');
    await bindToRadminIp(config(), '26.51.59.94');
    const content = await readFile(file, 'utf8');
    expect(content).toContain('server-ip=26.51.59.94');
    expect(content).not.toContain('26.27.250.137');
    expect(content).toContain('motd=Hola');
  });

  it('agrega server-ip si no existe', async () => {
    await writeFile(file, 'server-port=25565\n', 'utf8');
    await bindToRadminIp(config(), '10.0.0.5');
    expect(await readFile(file, 'utf8')).toContain('server-ip=10.0.0.5');
  });

  it('preserva los finales de línea CRLF', async () => {
    await writeFile(file, 'server-port=25565\r\nserver-ip=1.1.1.1\r\n', 'utf8');
    await bindToRadminIp(config(), '2.2.2.2');
    const content = await readFile(file, 'utf8');
    expect(content).toContain('server-ip=2.2.2.2\r\n');
    expect(content).not.toContain('\n\n');
  });

  it('no falla si el archivo no existe', async () => {
    await expect(bindToRadminIp(config(), '3.3.3.3')).resolves.toBeUndefined();
  });
});
