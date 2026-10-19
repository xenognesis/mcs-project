export type RepoRef = { owner: string; repo: string; branch?: string };

export type Player = { name: string; discordId: string };

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
