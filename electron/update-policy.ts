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

/** Resultado de la comprobación previa a jugar: `proceed` es true sólo si se puede iniciar/unir. */
export type UpdateGate = { proceed: true } | { proceed: false; message: string };

/**
 * Decisión previa a "iniciar / unirse": si ya hay una versión nueva descargada o en camino, no se
 * deja entrar a la partida para que la app se reinicie y se actualice primero. Sin novedades (o si
 * la verificación falló) se procede con normalidad.
 */
export function updateGateFor(phase: UpdatePhase, version?: string): UpdateGate {
  if (phase === 'downloaded') {
    return { proceed: false, message: 'Hay una versión nueva lista para instalarse: la aplicación se reiniciará y volverá a abrir actualizada. Esperá unos segundos y volvé a intentar.' };
  }
  if (phase === 'available' || phase === 'downloading') {
    return { proceed: false, message: `Hay una versión nueva${version ? ` (v${version})` : ''} disponible: se está descargando y la aplicación se reiniciará para instalarla. Volvé a intentar cuando termine.` };
  }
  return { proceed: true };
}
