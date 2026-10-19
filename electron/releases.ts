// Aviso de versión nueva en el canal de Discord de releases.
//
// Se envía con la API REST (como el bot), sin depender de que el bot esté conectado por gateway:
// el aviso tiene que salir apenas el actualizador detecta una versión más nueva, aunque todavía no
// se haya abierto el servidor.

/** Repositorio cuyas Releases se avisan (el mismo desde el que se actualiza la app). */
export const RELEASE_REPO = 'xenognesis/mcs-project';

/** Texto del aviso: "Versión X.X.X ya disponible" más el enlace a la release. */
export function releaseMessage(version: string): string {
  return `Versión ${version} ya disponible\nhttps://github.com/${RELEASE_REPO}/releases/tag/v${version}`;
}

/** Publica el aviso de versión nueva en el canal indicado. Devuelve `false` si faltan datos. */
export async function announceRelease(token: string, channelId: string, version: string): Promise<boolean> {
  if (!token || !channelId || !version) return false;
  const sent = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: releaseMessage(version) })
  });
  if (!sent.ok) throw new Error(`No se pudo avisar de la versión ${version} en el canal ${channelId} (HTTP ${sent.status}).`);
  return true;
}

export type ReleaseNotice = { version: string; by: string; announcedAt: string };

export type ReleaseNoticeOptions = {
  token: string;
  channelId: string;
  version: string;
  /** Quién registra el aviso; queda anotado en el archivo compartido. */
  by: string;
  /** true si esa versión ya se avisó (archivo de esta PC o repositorio compartido). */
  alreadyNoticed: (version: string) => Promise<boolean>;
  /** Registra el aviso (archivo local y, si se puede, repositorio compartido). */
  remember: (notice: ReleaseNotice) => Promise<void>;
  log: (line: string) => void;
};

/**
 * Avisa una versión nueva una sola vez: consulta si ya se avisó, publica en el canal y recién ahí lo
 * registra. Si la publicación falla, no queda registrada y el próximo intento la reintenta.
 */
export async function noticeReleaseOnce(options: ReleaseNoticeOptions): Promise<boolean> {
  const { token, channelId, version, by, log } = options;
  if (!token || !channelId || !version) return false;
  if (await options.alreadyNoticed(version)) return false;
  try {
    await announceRelease(token, channelId, version);
    await options.remember({ version, by, announcedAt: new Date().toISOString() });
    log(`[Versión] Aviso publicado en Discord: v${version}.`);
    return true;
  } catch (error) {
    log(`[Versión] No se pudo avisar de v${version}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
