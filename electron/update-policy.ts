import type { UpdatePhase } from './types';

// Reglas puras del actualizador: viven aparte de `updater.ts` para poder probarlas sin cargar
// electron ni electron-updater (que exigen el runtime de Electron).

/** Convierte bytes a un texto corto en español (ej. "12,4 MB") para el progreso de descarga. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 100) return `${Math.round(megabytes)} MB`;
  if (megabytes >= 10) return `${megabytes.toFixed(1).replace('.', ',')} MB`;
  return `${megabytes.toFixed(2).replace('.', ',')} MB`;
}

/** Porcentaje entero (0-100) a partir del evento `download-progress` de electron-updater. */
export function progressPercent(info: { percent?: number; transferred?: number; total?: number }): number {
  const raw = typeof info.percent === 'number' && Number.isFinite(info.percent)
    ? info.percent
    : info.total
      ? ((info.transferred ?? 0) / info.total) * 100
      : 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Sólo se reinicia para instalar cuando la descarga terminó y nada crítico está corriendo. Si el
 * servidor está en línea, la actualización queda pendiente y electron-updater la aplica al salir
 * (`autoInstallOnAppQuit`).
 */
export function shouldInstallNow(phase: UpdatePhase, serverRunning: boolean): boolean {
  return phase === 'downloaded' && !serverRunning;
}
