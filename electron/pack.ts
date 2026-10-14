import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitHubClient } from './github';
import { LoaderRegistry } from './loaders';
import type { AppConfig, PackManifest } from './types';

const digest = (input: Buffer) => createHash('sha256').update(input).digest('hex');
const safeTarget = (root: string, relative: string) => {
  const target = path.resolve(root, relative); if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Ruta de pack inválida: ${relative}`); return target;
};
export async function fetchManifest(config: AppConfig) {
  const github = new GitHubClient(config.githubToken ?? '');
  const remote = await github.getJson<PackManifest>(config.packRepo, 'manifest.json');
  if (!remote) throw new Error('No existe manifest.json en el repositorio de pack.');
  const adapter = new LoaderRegistry().get(remote.value.loader);
  if (!adapter) throw new Error(`Loader no compatible: ${remote.value.loader}`);
  const issues = adapter.validate(remote.value); if (issues.length) throw new Error(issues.join(' '));
  return remote.value;
}
export async function syncPack(config: AppConfig, log: (message: string) => void) {
  const manifest = await fetchManifest(config);
  for (const file of manifest.files) {
    let clientRoot = '';
    if (config.manualLauncher) {
      if (config.clientInstancePath) {
        clientRoot = config.clientInstancePath;
      } else {
        if (file.scope === 'client') {
          log(`Omitiendo ${file.path} (launcher manual sin ruta de instancia especificada)`);
          continue;
        }
      }
    } else if (config.multiMcPath) {
      // MultiMC almacena los archivos de juego de una instancia dentro de .minecraft.
      clientRoot = path.join(path.dirname(config.multiMcPath), 'instances', config.multiMcInstance, '.minecraft');
    } else if (file.scope === 'client') {
      continue;
    }
    const target = safeTarget(file.scope === 'client' ? clientRoot : config.driveRoot, file.path);
    try { if (digest(await readFile(target)) === file.sha256) continue; } catch { /* download below */ }
    log(`Actualizando ${file.path}`);
    const response = await fetch(file.url, { headers: config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {} });
    if (!response.ok) throw new Error(`No se pudo descargar ${file.path}.`);
    const content = Buffer.from(await response.arrayBuffer());
    if (digest(content) !== file.sha256) throw new Error(`El hash de ${file.path} no coincide.`);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.lantern-download`; await writeFile(temp, content); await rename(temp, target);
  }
  return manifest;
}
export async function publishManifest(config: AppConfig, manifest: PackManifest) {
  if (!config.isAdmin) throw new Error('Sólo un administrador puede publicar un pack.');
  const adapter = new LoaderRegistry().get(manifest.loader);
  const issues = adapter?.validate(manifest) ?? [`Loader no compatible: ${manifest.loader}`];
  if (issues.length) throw new Error(issues.join(' '));
  const github = new GitHubClient(config.githubToken ?? '');
  const current = await github.getJson<PackManifest>(config.packRepo, 'manifest.json');
  await github.putJson(config.packRepo, 'manifest.json', manifest, current?.sha, `Publish pack ${manifest.version}`);
}
