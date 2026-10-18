import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import { formatBytes, progressPercent, shouldInstallNow } from './update-policy';
import type { UpdateState } from './types';

// Auto-actualización vía GitHub Releases del propio repositorio de la aplicación.
//
// El repo es privado, así que se configura el provider de GitHub en tiempo de ejecución con un
// token (`private: true` + `token`), lo que hace que electron-updater use la API con autenticación
// en lugar de las URLs públicas de descarga. El token de publishing NUNCA se embebe en el binario:
// se lee de la configuración local (cifrada con DPAPI) en cada arranque.

export type UpdaterRepo = { owner: string; repo: string };

export type UpdaterOptions = {
  /** Versión instalada (app.getVersion()). */
  currentVersion: string;
  /** app.isPackaged: fuera de la app instalada el updater de electron-updater queda inactivo. */
  packaged: boolean;
  repo: UpdaterRepo;
  /** Token con permiso de lectura sobre los Releases del repo (vacío = no se puede verificar). */
  token: string;
  onState: (state: UpdateState) => void;
  /** true mientras el servidor no está detenido: bloquea el reinicio automático. */
  serverRunning: () => boolean;
  log: (line: string) => void;
};

export type Updater = {
  check: (manual: boolean) => Promise<UpdateState>;
  install: () => void;
  state: () => UpdateState;
};

export function createUpdater(options: UpdaterOptions): Updater {
  let state: UpdateState = { phase: 'idle' };
  let manualCheck = false;
  const setState = (next: UpdateState) => { state = next; options.onState(next); };

  if (!options.packaged) {
    return {
      check: async () => { setState({ phase: 'error', message: 'Las actualizaciones automáticas sólo funcionan en la aplicación instalada.' }); return state; },
      install: () => undefined,
      state: () => state
    };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => options.log(`[Actualización] ${String(message ?? '')}`),
    warn: (message?: unknown) => options.log(`[Actualización] ${String(message ?? '')}`),
    error: (message?: unknown) => options.log(`[Actualización] ${String(message ?? '')}`)
  };
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: options.repo.owner,
    repo: options.repo.repo,
    private: true,
    token: options.token
  });

  autoUpdater.on('checking-for-update', () => { if (manualCheck) setState({ phase: 'checking' }); });
  autoUpdater.on('update-available', (info: UpdateInfo) => setState({ phase: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => setState(manualCheck ? { phase: 'current', version: options.currentVersion } : { phase: 'idle' }));
  autoUpdater.on('download-progress', (info: ProgressInfo) => setState({ phase: 'downloading', version: state.version, percent: progressPercent(info), detail: `${formatBytes(info.transferred)} de ${formatBytes(info.total)}` }));
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({ phase: 'downloaded', version: info.version });
    if (!shouldInstallNow('downloaded', options.serverRunning())) {
      options.log('[Actualización] Descargada; se instalará al cerrar el servidor y salir.');
      return;
    }
    options.log('[Actualización] Descargada; reiniciando para instalarla.');
    setTimeout(install, 2500);
  });
  autoUpdater.on('error', (error: Error) => {
    // Un repo sin releases todavía (o sin token válido) no debe romper el arranque: sólo se avisa
    // cuando el usuario pidió la verificación a mano.
    if (!manualCheck) { options.log(`[Actualización] No se pudo verificar: ${error.message}`); setState({ phase: 'idle' }); return; }
    setState({ phase: 'error', message: error.message });
  });

  function install() {
    if (state.phase !== 'downloaded') { options.log('[Actualización] Todavía no hay una versión descargada.'); return; }
    if (options.serverRunning()) { options.log('[Actualización] No se instala con el servidor en línea.'); return; }
    // quitAndInstall(silent, forceRunAfter): cierra la app, ejecuta el instalador sin asistente y
    // vuelve a abrirla con la versión nueva.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  async function check(manual: boolean): Promise<UpdateState> {
    manualCheck = manual;
    if (!options.token) {
      if (manual) setState({ phase: 'error', message: 'Falta el token de GitHub para buscar actualizaciones.' });
      else options.log('[Actualización] Sin token configurado; se omite la verificación automática.');
      return state;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (manual) setState({ phase: 'error', message });
      else options.log(`[Actualización] ${message}`);
    }
    return state;
  }

  return { check, install, state: () => state };
}
