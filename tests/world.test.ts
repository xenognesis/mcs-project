import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashDirectory, worldPaths } from '../electron/world';

describe('electron/world hashDirectory', () => {
  let root: string;
  let world: string;

  const write = async (relative: string, content: string) => {
    const target = path.join(world, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-world-test-'));
    world = worldPaths(root).world;
    await mkdir(world, { recursive: true });
    await write('level.dat', 'mundo-inicial');
    await write(path.join('region', 'r.0.0.mca'), 'chunk');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('devuelve un hash estable para el mismo contenido', async () => {
    expect(await hashDirectory(world)).toBe(await hashDirectory(world));
  });

  it('detecta cambios en archivos reales del mundo', async () => {
    const before = await hashDirectory(world);
    await write(path.join('region', 'r.0.0.mca'), 'chunk-modificado');
    expect(await hashDirectory(world)).not.toBe(before);
  });

  it('ignora random_sequences.dat en cualquier carpeta', async () => {
    const before = await hashDirectory(world);
    await write(path.join('data', 'minecraft', 'random_sequences.dat'), 'secuencias');
    expect(await hashDirectory(world)).toBe(before);
    await write(path.join('data', 'random_sequences.dat'), 'secuencias-otra-ubicacion');
    expect(await hashDirectory(world)).toBe(before);
  });

  it('ignora la carpeta crash-reports', async () => {
    const before = await hashDirectory(world);
    await write(path.join('crash-reports', 'crash-2026-10-15.txt'), 'stacktrace');
    expect(await hashDirectory(world)).toBe(before);
  });

  it('devuelve null si el mundo no existe', async () => {
    await rm(world, { recursive: true, force: true });
    expect(await hashDirectory(world)).toBeNull();
  });
});
