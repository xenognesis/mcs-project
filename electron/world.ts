import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackupEntry, BackupFile, BackupKind, BackupManifest } from './types';

export const worldPaths = (root: string) => ({
  world: path.join(root, 'world'),
  backups: path.join(root, 'backups'),
  /** Bóveda de contenidos: un archivo por hash único, compartido por todos los backups incrementales. */
  objects: path.join(root, 'backups', 'objects'),
  /** Backups completos (autocontenidos): una carpeta por backup, sin depender de `objects`. */
  full: path.join(root, 'backups', 'full'),
  manifest: path.join(root, 'world-state.json'),
  conflicts: path.join(root, 'conflicts')
});

/**
 * Archivos que forman parte del mundo "lógico". Los volátiles que el servidor reescribe o que no
 * representan avance quedan afuera: así el hash no falla por desincronización de Drive y los
 * backups no arrastran basura (por ejemplo `session.lock`, que además no conviene restaurar).
 */
async function files(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const list: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'session.lock' || entry.name === 'desktop.ini' || entry.name === 'random_sequences.dat' || entry.name === 'crash-reports' || entry.name.endsWith('.tmp') || entry.name.endsWith('.dat_old') || entry.name.startsWith('.goutputstream') || entry.name.startsWith('~')) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) list.push(...await files(root, next)); else if (entry.isFile()) list.push(next);
  }
  return list.sort();
}

/** Lee un archivo reintentando cuando el servidor lo tiene tomado en pleno guardado. */
async function readWithRetry(target: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try { return await readFile(target); }
    catch (error: any) {
      if ((error.code === 'EBUSY' || error.code === 'EPERM') && attempt < 4) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
      throw error;
    }
  }
}

const exists = async (target: string) => { try { await access(target); return true; } catch { return false; } };

/** Ruta del contenido dentro de la bóveda: `objects/<2 primeros dígitos>/<sha256>`. */
const objectPath = (paths: Paths, sha256: string) => path.join(paths.objects, sha256.slice(0, 2), sha256);

const manifestFile = (dir: string, name: string) => path.join(dir, `${name}.json`);

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** `2026-10-20T04-45-56-966Z-hourly` -> `2026-10-20T04:45:56.966Z`. */
export function nameToDate(name: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : name;
}

type Paths = ReturnType<typeof worldPaths>;
/** Ficha de un backup completo, guardada al lado de su carpeta para poder listarlo sin recorrerlo. */
type FullRecord = { createdAt: string; reason: 'shutdown'; bytes: number; files: number };

const readJson = async <T>(file: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
};

export async function hashDirectory(root: string): Promise<string | null> {
  try { await access(root); } catch { return null; }
  const hash = createHash('sha256');
  for (const relative of await files(root)) {
    hash.update(relative);
    hash.update(await readWithRetry(path.join(root, relative)));
  }
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

/**
 * Crea un backup del mundo.
 *
 * - `hourly`: **incremental**. Cada archivo se guarda una sola vez en `backups/objects` (identificado
 *   por su hash) y el backup es un manifiesto con la lista de archivos. Como el mundo cambia poco,
 *   cada backup ocupa sólo lo que cambió. Se conservan los últimos `retention`.
 * - `shutdown`: **completo y autocontenido**. Una copia entera del mundo en `backups/full/<nombre>`,
 *   que no depende de `objects`. Se conservan los últimos `fullRetention`.
 *
 * En ambos casos devuelve la ficha del backup creado.
 */
export async function snapshot(root: string, reason: 'hourly' | 'shutdown', retention: number, fullRetention = 2): Promise<BackupEntry> {
  const paths = worldPaths(root); await mkdir(paths.backups, { recursive: true });
  const name = `${stamp()}-${reason}`;
  return reason === 'shutdown' ? fullSnapshot(paths, name, fullRetention) : incrementalSnapshot(paths, name, retention);
}

async function incrementalSnapshot(paths: Paths, name: string, retention: number): Promise<BackupEntry> {
  const hash = createHash('sha256');
  const entries: BackupFile[] = [];
  let bytes = 0; let addedBytes = 0;
  await mkdir(paths.objects, { recursive: true });
  for (const relative of await files(paths.world)) {
    const content = await readWithRetry(path.join(paths.world, relative));
    const sha256 = createHash('sha256').update(content).digest('hex');
    entries.push({ path: relative, sha256, size: content.length });
    bytes += content.length;
    // Mismo orden y mismos bytes que hashDirectory, para que el hash del backup sea comparable.
    hash.update(relative); hash.update(content);
    const object = objectPath(paths, sha256);
    if (!await exists(object)) {
      await mkdir(path.dirname(object), { recursive: true });
      await writeFile(object, content);
      addedBytes += content.length;
    }
  }
  const manifest: BackupManifest = { createdAt: new Date().toISOString(), reason: 'hourly', bytes, addedBytes, hash: hash.digest('hex'), files: entries };
  await writeFile(manifestFile(paths.backups, name), JSON.stringify(manifest), 'utf8');
  await pruneIncrementals(paths, retention);
  return { name, kind: 'incremental', createdAt: manifest.createdAt, files: entries.length, bytes, addedBytes };
}

async function fullSnapshot(paths: Paths, name: string, retention: number): Promise<BackupEntry> {
  const createdAt = new Date().toISOString();
  let bytes = 0; let count = 0;
  for (const relative of await files(paths.world)) { bytes += (await stat(path.join(paths.world, relative))).size; count++; }
  await mkdir(paths.full, { recursive: true });
  await cp(paths.world, path.join(paths.full, name), { recursive: true, errorOnExist: true });
  const record: FullRecord = { createdAt, reason: 'shutdown', bytes, files: count };
  await writeFile(manifestFile(paths.full, name), JSON.stringify(record), 'utf8');
  await pruneFulls(paths, retention);
  return { name, kind: 'completo', createdAt, files: count, bytes, addedBytes: bytes };
}

/** Conserva sólo los últimos `retention` backups incrementales y libera los contenidos que ya nadie usa. */
async function pruneIncrementals(paths: Paths, retention: number) {
  const names = await incrementalNames(paths);
  const removed: string[] = [];
  while (names.length > Math.max(1, retention)) removed.push(names.shift()!);
  for (const name of removed) await rm(manifestFile(paths.backups, name), { force: true });
  await collectObjects(paths, names);
}

const incrementalNames = async (paths: Paths): Promise<string[]> => {
  try {
    return (await readdir(paths.backups, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length)).sort();
  } catch { return []; }
};

/** Borra de `objects` todo contenido que no referencie ninguno de los backups que quedan. */
async function collectObjects(paths: Paths, manifests: string[]) {
  const referenced = new Set<string>();
  for (const name of manifests) {
    const manifest = await readJson<BackupManifest>(manifestFile(paths.backups, name));
    if (!manifest) return; // Si un manifiesto no se puede leer, no sabemos qué referencian: no borramos nada.
    for (const entry of manifest.files) referenced.add(entry.sha256);
  }
  let buckets: string[] = [];
  try { buckets = await readdir(paths.objects); } catch { return; }
  for (const bucket of buckets) {
    const dir = path.join(paths.objects, bucket);
    let kept = 0;
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (referenced.has(entry.name)) { kept++; continue; }
        await rm(path.join(dir, entry.name), { force: true });
      }
    } catch { continue; }
    if (!kept) await rm(dir, { recursive: true, force: true });
  }
}

async function pruneFulls(paths: Paths, retention: number) {
  let dirs: Dirent[] = [];
  try { dirs = (await readdir(paths.full, { withFileTypes: true })).filter((entry) => entry.isDirectory()); } catch { return; }
  const names = dirs.map((entry) => entry.name).sort();
  while (names.length > Math.max(1, retention)) {
    const name = names.shift()!;
    await rm(path.join(paths.full, name), { recursive: true, force: true });
    await rm(manifestFile(paths.full, name), { force: true });
  }
}

/** Backups disponibles para restaurar, del más nuevo al más viejo. */
export async function listBackups(root: string): Promise<BackupEntry[]> {
  const paths = worldPaths(root);
  const list: BackupEntry[] = [];
  let entries: Dirent[] = [];
  try { entries = await readdir(paths.backups, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const name = entry.name.slice(0, -'.json'.length);
      const manifest = await readJson<BackupManifest>(path.join(paths.backups, entry.name));
      list.push({ name, kind: 'incremental', createdAt: manifest?.createdAt ?? nameToDate(name), files: manifest?.files.length ?? 0, bytes: manifest?.bytes ?? 0, addedBytes: manifest?.addedBytes });
    } else if (entry.isDirectory() && entry.name !== 'objects' && entry.name !== 'full') {
      // Backups completos del formato anterior: siguen siendo restaurables tal cual.
      list.push({ name: entry.name, kind: 'completo', createdAt: nameToDate(entry.name), files: 0, bytes: 0 });
    }
  }
  let fulls: Dirent[] = [];
  try { fulls = await readdir(paths.full, { withFileTypes: true }); } catch { /* todavía no hay backups completos */ }
  for (const entry of fulls) {
    if (!entry.isDirectory()) continue;
    const record = await readJson<FullRecord>(manifestFile(paths.full, entry.name));
    list.push({ name: entry.name, kind: 'completo', createdAt: record?.createdAt ?? nameToDate(entry.name), files: record?.files ?? 0, bytes: record?.bytes ?? 0 });
  }
  return list.sort((a, b) => b.name.localeCompare(a.name));
}

/** Averigua dónde vive el backup pedido: incremental (`.json`), completo (`full/`) o del formato anterior. */
async function locateBackup(paths: Paths, backup: string) {
  const incremental = manifestFile(paths.backups, backup);
  if (await exists(incremental)) return { manifest: await readJson<BackupManifest>(incremental), source: null };
  const full = path.join(paths.full, backup);
  if (await exists(full)) return { manifest: null, source: full };
  const legacy = path.join(paths.backups, backup);
  if (await exists(legacy)) return { manifest: null, source: legacy };
  return null;
}

/**
 * Mueve el mundo actual a `conflicts/` y restaura el backup pedido.
 *
 * Si algo falla a mitad (contenido dañado, hash que no cierra), el mundo previo vuelve a su lugar:
 * restaurar nunca deja el mundo a medias.
 */
export async function archiveThenRestore(root: string, backup: string, host = 'Restauración'): Promise<{ archived: string; hash: string | null; kind: BackupKind }> {
  const paths = worldPaths(root);
  const found = await locateBackup(paths, backup);
  if (!found) throw new Error('El backup solicitado no existe.');
  const { manifest, source } = found;
  if (manifest) {
    // Revisamos que esté todo el contenido ANTES de tocar el mundo actual.
    const missing: string[] = [];
    for (const entry of manifest.files) if (!await exists(objectPath(paths, entry.sha256))) missing.push(entry.path);
    if (missing.length) throw new Error(`Faltan ${missing.length} archivo(s) de este backup (por ejemplo ${missing[0]}). No se restauró nada.`);
  }
  await mkdir(paths.conflicts, { recursive: true });
  const archived = path.join(paths.conflicts, `world-${stamp()}-${randomUUID()}`);
  await rename(paths.world, archived);
  try {
    if (manifest) await restoreManifest(paths, manifest);
    else await cp(source!, paths.world, { recursive: true });
  } catch (error) {
    await rm(paths.world, { recursive: true, force: true });
    await rename(archived, paths.world);
    throw error;
  }
  const hash = await publishWorldState(root, host);
  return { archived, hash, kind: manifest ? 'incremental' : 'completo' };
}

/** Reconstruye el mundo desde la bóveda verificando cada archivo y el hash final. */
async function restoreManifest(paths: Paths, manifest: BackupManifest) {
  const hash = createHash('sha256');
  for (const entry of manifest.files) {
    const content = await readFile(objectPath(paths, entry.sha256));
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256) throw new Error(`El contenido guardado para ${entry.path} está dañado (el hash no coincide).`);
    const target = path.join(paths.world, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    hash.update(entry.path); hash.update(content);
  }
  if (manifest.hash && hash.digest('hex') !== manifest.hash) throw new Error('Los archivos restaurados no coinciden con el hash del backup.');
}
