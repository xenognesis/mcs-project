import { execFile } from 'node:child_process';

export type TrashConfig = {
  /** Ejecutable de rclone. Vacío = `rclone` del PATH. */
  rclonePath?: string;
  /** Remoto de rclone que apunta a Google Drive (ej. `gdrive`). Vacío = deshabilitado. */
  rcloneRemote?: string;
};

/**
 * `rclone cleanup` espera el remoto con dos puntos (`gdrive:`), pero en la
 * configuración es más natural escribir sólo el nombre. Aceptamos ambos y
 * normalizamos para que no se acumulen dos puntos.
 */
export function rcloneCleanupTarget(remote: string): string {
  // `rclone cleanup` no acepta una ruta: sólo el remoto. Si el usuario escribe
  // `gdrive:` o `gdrive:carpeta`, nos quedamos con el nombre del remoto.
  const clean = remote.trim().replace(/:.*$/, '');
  if (!clean) throw new Error('El remoto de rclone está vacío.');
  return `${clean}:`;
}

/**
 * Vacía la papelera de Google Drive en segundo plano. No bloquea el arranque del
 * servidor y cualquier fallo se escribe en la bitácora. Si `rcloneRemote` está
 * vacío, la función no hace nada (la función queda deshabilitada).
 */
export function cleanupDriveTrash(
  config: TrashConfig,
  log: (line: string) => void,
  run: typeof execFile = execFile,
  timeoutMs = 120_000
) {
  const remote = config.rcloneRemote?.trim();
  if (!remote) return;

  let target: string;
  try {
    target = rcloneCleanupTarget(remote);
  } catch (error) {
    log(`[rclone] Configuración inválida: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const binary = config.rclonePath?.trim() || 'rclone';
  log(`[rclone] Vaciando la papelera de Google Drive (${target})…`);
  run(binary, ['cleanup', target], { timeout: timeoutMs, windowsHide: true }, (error, _stdout, stderr) => {
    if (error) {
      const detail = (stderr || '').trim() || error.message;
      log(`[rclone] No se pudo vaciar la papelera: ${detail}`);
      return;
    }
    log(`[rclone] Papelera de Google Drive vaciada (${target}).`);
  });
}
