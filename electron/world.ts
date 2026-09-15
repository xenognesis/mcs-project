import { createHash, randomUUID } from 'node:crypto';
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const worldPaths = (root: string) => ({ world: path.join(root, 'world'), backups: path.join(root, 'backups'), manifest: path.join(root, 'world-state.json'), conflicts: path.join(root, 'conflicts') });

async function files(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const list: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) list.push(...await files(root, next)); else if (entry.isFile()) list.push(next);
  }
  return list.sort();
}
export async function hashDirectory(root: string): Promise<string | null> {
  try { await access(root); } catch { return null; }
  const hash = createHash('sha256');
  for (const relative of await files(root)) { hash.update(relative); hash.update(await readFile(path.join(root, relative))); }
  return hash.digest('hex');
}
export async function readPublishedHash(root: string): Promise<string | null> {
  try { return (JSON.parse(await readFile(worldPaths(root).manifest, 'utf8')) as { hash: string }).hash; } catch { return null; }
}
export async function publishWorldState(root: string, host: string) {
  const paths = worldPaths(root); const hash = await hashDirectory(paths.world);
  if (!hash) throw new Error('No existe la carpeta world en Google Drive.');
  await writeFile(paths.manifest, JSON.stringify({ hash, host, publishedAt: new Date().toISOString() }, null, 2));
  return hash;
}
export async function snapshot(root: string, reason: 'hourly' | 'shutdown', retention: number) {
  const paths = worldPaths(root); await mkdir(paths.backups, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}`;
  await cp(paths.world, path.join(paths.backups, name), { recursive: true, errorOnExist: true });
  const entries = (await readdir(paths.backups, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  while (entries.length > retention) await rm(path.join(paths.backups, entries.shift()!), { recursive: true, force: true });
  return name;
}
export async function listBackups(root: string) {
  try { return (await readdir(worldPaths(root).backups, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse(); } catch { return []; }
}
export async function archiveThenRestore(root: string, backup: string) {
  const paths = worldPaths(root); const source = path.join(paths.backups, backup);
  if (!(await stat(source)).isDirectory()) throw new Error('El backup solicitado no existe.');
  await mkdir(paths.conflicts, { recursive: true });
  const archived = path.join(paths.conflicts, `world-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await rename(paths.world, archived); await cp(source, paths.world, { recursive: true });
  return archived;
}
