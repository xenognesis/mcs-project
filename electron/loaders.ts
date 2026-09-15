import type { PackManifest } from './types';

export interface LoaderAdapter {
  readonly id: PackManifest['loader'];
  validate(manifest: PackManifest): string[];
}
export class FabricAdapter implements LoaderAdapter {
  readonly id = 'fabric' as const;
  validate(manifest: PackManifest) {
    const issues: string[] = [];
    if (!manifest.minecraftVersion) issues.push('Falta la versión de Minecraft.');
    if (!manifest.serverJar) issues.push('Falta la ruta del JAR del servidor Fabric.');
    if (!manifest.files.length) issues.push('El manifiesto no contiene archivos.');
    return issues;
  }
}
export class LoaderRegistry {
  private adapters: LoaderAdapter[] = [new FabricAdapter()];
  get(loader: PackManifest['loader']) { return this.adapters.find((adapter) => adapter.id === loader); }
}
