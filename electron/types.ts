export type RepoRef = { owner: string; repo: string; branch?: string };

export type Player = { name: string; discordId: string };

export type AppConfig = {
  playerName: string;
  isAdmin: boolean;
  discordBotToken?: string;
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
export type AppStatus = {
  requirements: Requirement[];
  lease: Lease | null;
  localWorldHash: string | null;
  publishedWorldHash: string | null;
  radminIp: string | null;
  server: 'stopped' | 'starting' | 'running' | 'stopping';
  logs: string[];
};
