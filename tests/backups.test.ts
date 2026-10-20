import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { archiveThenRestore, hashDirectory, listBackups, snapshot, worldPaths } from '../electron/world';

/** Espera mínima para que dos backups no compartan el mismo sello de tiempo. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('electron/world backups', () => {
  let root: string;
  let world: string;

  const write = async (relative: string, content: string) => {
    const target = path.join(world, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  };
  const objectFiles = async () => {
    const out: string[] = [];
    try {
      for (const bucket of await readdir(worldPaths(root).objects)) for (const file of await readdir(path.join(worldPaths(root).objects, bucket))) out.push(file);
    } catch { /* todavía no hay contenidos guardados */ }
    return out.sort();
  };
  const conflicts = async () => { try { return await readdir(path.join(root, 'conflicts')); } catch { return []; } };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-backup-test-'));
    world = worldPaths(root).world;
    await mkdir(world, { recursive: true });
    await write('level.dat', 'mundo-inicial');
    await write(path.join('region', 'r.0.0.mca'), 'chunk');
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('guarda cada contenido una sola vez entre backups incrementales', async () => {
    const first = await snapshot(root, 'hourly', 20);
    expect(first).toMatchObject({ kind: 'incremental', files: 2, bytes: 'mundo-inicial'.length + 'chunk'.length, addedBytes: 'mundo-inicial'.length + 'chunk'.length });
    expect(await objectFiles()).toHaveLength(2);

    await tick();
    await write('level.dat', 'mundo-modificado');
    const second = await snapshot(root, 'hourly', 20);

    expect(second.files).toBe(2);
    expect(second.bytes).toBe(first.bytes + 'mundo-modificado'.length - 'mundo-inicial'.length);
    // Sólo el archivo modificado agrega contenido nuevo a la bóveda.
    expect(second.addedBytes).toBe('mundo-modificado'.length);
    expect(await objectFiles()).toHaveLength(3);
    expect(await listBackups(root)).toHaveLength(2);
  });

  it('el hash del backup coincide con el del mundo y con el publicado al restaurar', async () => {
    const backup = await snapshot(root, 'hourly', 20);
    const manifest = JSON.parse(await readFile(path.join(root, 'backups', `${backup.name}.json`), 'utf8'));
    expect(manifest.hash).toBe(await hashDirectory(world));

    await write('level.dat', 'mundo-roto');
    const result = await archiveThenRestore(root, backup.name, 'Test');
    expect(result).toMatchObject({ kind: 'incremental' });
    expect(result.hash).toBe(manifest.hash);
    expect(JSON.parse(await readFile(worldPaths(root).manifest, 'utf8')).hash).toBe(manifest.hash);
  });

  it('restaura el mundo tal como estaba, sin sobrantes', async () => {
    const backup = await snapshot(root, 'hourly', 20);
    await write('level.dat', 'mundo-roto');
    await write(path.join('region', 'r.1.1.mca'), 'basura');

    await archiveThenRestore(root, backup.name, 'Test');

    expect(await readFile(path.join(world, 'level.dat'), 'utf8')).toBe('mundo-inicial');
    expect(await readdir(path.join(world, 'region'))).toEqual(['r.0.0.mca']);
    expect(await conflicts()).toHaveLength(1);
  });

  it('no toca el mundo si falta contenido del backup', async () => {
    const backup = await snapshot(root, 'hourly', 20);
    await write('level.dat', 'mundo-nuevo');
    for (const object of await objectFiles()) await rm(path.join(worldPaths(root).objects, object.slice(0, 2), object), { force: true });

    await expect(archiveThenRestore(root, backup.name)).rejects.toThrow(/Faltan/);
    expect(await readFile(path.join(world, 'level.dat'), 'utf8')).toBe('mundo-nuevo');
    expect(await conflicts()).toHaveLength(0);
  });

  it('devuelve el mundo previo a su lugar si el contenido guardado está dañado', async () => {
    const backup = await snapshot(root, 'hourly', 20);
    await write('level.dat', 'mundo-nuevo');
    const [object] = await objectFiles();
    await writeFile(path.join(worldPaths(root).objects, object.slice(0, 2), object), 'contenido-dañado');

    await expect(archiveThenRestore(root, backup.name)).rejects.toThrow(/dañado/);
    expect(await readFile(path.join(world, 'level.dat'), 'utf8')).toBe('mundo-nuevo');
    expect(await readdir(path.join(world, 'region'))).toEqual(['r.0.0.mca']);
    // El mundo previo vuelve a su lugar: no queda nada a medias ni en conflicts.
    expect(await conflicts()).toHaveLength(0);
  });

  it('conserva sólo la cantidad pedida y libera lo que ya nadie usa', async () => {
    for (const content of ['uno', 'dos', 'tres']) { await tick(); await write('level.dat', content); await snapshot(root, 'hourly', 2); }

    expect(await listBackups(root)).toHaveLength(2);
    // El contenido de 'uno' quedó sin referencias; los otros dos y el chunk siguen en la bóveda.
    expect(await objectFiles()).toHaveLength(3);
  });

  it('guarda los backups completos aparte, con su propia retención', async () => {
    const first = await snapshot(root, 'shutdown', 20, 2);
    expect(first).toMatchObject({ kind: 'completo', files: 2, bytes: 'mundo-inicial'.length + 'chunk'.length });
    expect(await readFile(path.join(worldPaths(root).full, first.name, 'level.dat'), 'utf8')).toBe('mundo-inicial');
    expect(await listBackups(root)).toHaveLength(1);
    // Los completos no usan la bóveda de contenidos.
    expect(await objectFiles()).toHaveLength(0);

    await tick();
    const second = await snapshot(root, 'shutdown', 20, 1);
    expect((await listBackups(root)).map((entry) => entry.name)).toEqual([second.name]);
  });

  it('sigue restaurando los backups completos del formato anterior', async () => {
    const legacy = path.join(worldPaths(root).backups, '2026-10-19T10-00-00-000Z-hourly');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'level.dat'), 'mundo-viejo');
    await write('level.dat', 'mundo-actual');

    const [backup] = await listBackups(root);
    expect(backup).toMatchObject({ name: '2026-10-19T10-00-00-000Z-hourly', kind: 'completo', createdAt: '2026-10-19T10:00:00.000Z' });

    await archiveThenRestore(root, backup.name, 'Test');
    expect(await readFile(path.join(world, 'level.dat'), 'utf8')).toBe('mundo-viejo');
  });
});
