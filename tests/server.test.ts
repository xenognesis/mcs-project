import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bindToRadminIp, MinecraftServer } from '../electron/server';
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

  it('fuerza level-name=world para no crear otra carpeta de mundo', async () => {
    await writeFile(file, 'level-name=MCS Test\nserver-port=25566\n', 'utf8');
    await bindToRadminIp(config(), '10.0.0.5');
    const content = await readFile(file, 'utf8');
    expect(content).toContain('level-name=world');
    expect(content).not.toContain('level-name=MCS Test');
  });

  it('agrega level-name=world si no existe', async () => {
    await writeFile(file, 'server-port=25566\n', 'utf8');
    await bindToRadminIp(config(), '10.0.0.5');
    expect(await readFile(file, 'utf8')).toContain('level-name=world');
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

describe('electron/server MinecraftServer.start', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-server-start-'));
    await writeFile(path.join(root, 'server.jar'), 'no-es-un-jar-real', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('falla rápido y describe el motivo si el ejecutable de Java no existe', async () => {
    const server = new MinecraftServer(() => undefined, () => undefined);
    const settings = { driveRoot: root, serverJar: 'server.jar', javaPath: 'lantern-no-existe-xyz', serverMemoryMb: 1024 } as AppConfig;
    await expect(server.start(settings)).rejects.toThrow(/Últimas líneas/);
    expect(server.status).toBe('stopped');
  });
});
