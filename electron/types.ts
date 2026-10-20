export type RepoRef = { owner: string; repo: string; branch?: string };

export type Player = { name: string; discordId: string };

export type BackupKind = 'incremental' | 'completo';

/** Un archivo del mundo dentro de un backup incremental: su ruta relativa y el hash de su contenido. */
export type BackupFile = { path: string; sha256: string; size: number };

/** Manifiesto de un backup incremental: qué contenía el mundo en ese momento. */
export type BackupManifest = {
  createdAt: string;
  reason: 'hourly';
  /** Tamaño del mundo en ese momento, no lo que ocupa el backup. */
  bytes: number;
  /** Bytes que hubo que guardar por primera vez; el resto ya estaba en `backups/objects`. */
  addedBytes: number;
  /** Hash del mundo completo, calculado igual que hashDirectory. */
  hash: string;
  files: BackupFile[];
};

/** Backup disponible para restaurar, tal como lo muestra la interfaz. */
export type BackupEntry = {
  name: string;
  kind: BackupKind;
  createdAt: string;
  files: number;
  /** Tamaño del mundo en ese momento (0 si el formato anterior no lo registró). */
  bytes: number;
  /** Sólo en incrementales: bytes que agregó este backup. */
  addedBytes?: number;
};

export type AppConfig = {
  playerName: string;
  isAdmin: boolean;
  discordBotToken?: string;
  discordChannelId?: string;
  discordGuildId?: string;
  /** Canal de Discord donde se avisa cuando hay una versión nueva ("Versión X.X.X ya disponible"). */
  releasesChannelId?: string;
  trackerDataPath?: string;
  githubToken?: string;
  packRepo: RepoRef;
  coordinationRepo: RepoRef;
  driveRoot: string;
  multiMcPath: string;
  multiMcInstance: string;
  javaPath: string;
  serverJar: string;
  serverMemoryMb: number;
  port: number;
  players: Player[];
  backupIntervalMinutes: number;
  backupRetention: number;
  /** Cuántos backups completos (al cerrar el servidor) se conservan. Ocupan el mundo entero cada uno. */
  fullBackupRetention: number;
  adminPassword?: string;
  adminDiscordId?: string;
  manualLauncher?: boolean;
  clientInstancePath?: string;
  radminPath?: string;
  timeZone: string;
};

export type Lease = {
  sessionId: string;
  hostName: string;
  ip: string;
  port: number;
  packVersion: string;
  startedAt: string;
  heartbeatAt: string;
};

export type PackManifest = {
  version: string;
  minecraftVersion: string;
  loader: 'fabric' | 'neoforge';
  serverJar: string;
  clientArchive: string;
  files: Array<{ path: string; sha256: string; url: string; scope?: 'server' | 'client' }>;
};

export type Requirement = { name: string; ok: boolean; detail: string };
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error';
export type UpdateState = {
  phase: UpdatePhase;
  /** Versión que ofrece el repositorio (en fases available/downloading/downloaded) o la instalada. */
  version?: string;
  /** Progreso de descarga 0-100. */
  percent?: number;
  /** Detalle legible del progreso (ej. "12,4 MB de 108 MB"). */
  detail?: string;
  /** Mensaje de error, sólo en la fase `error`. */
  message?: string;
};
export type AppStatus = {
  requirements: Requirement[];
  lease: Lease | null;
  localWorldHash: string | null;
  publishedWorldHash: string | null;
  radminIp: string | null;
  server: 'stopped' | 'starting' | 'running' | 'stopping';
  logs: string[];
  consoleUnlocked: boolean;
  hasAdminSecret: boolean;
  version: string;
  update: UpdateState;
};
