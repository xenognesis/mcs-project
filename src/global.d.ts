export {};
declare module '*.css';
declare global {
  interface Window {
    lantern: {
      status: () => Promise<AppStatus>; sync: (kind?: 'survival' | 'tests') => Promise<{ manifest: PackManifest; status: AppStatus }>; copyTestsWorld: () => Promise<AppStatus>; start: (kind?: 'survival' | 'tests') => Promise<AppStatus>; stop: (kind?: 'survival' | 'tests') => Promise<AppStatus>; join: (kind?: 'survival' | 'tests') => Promise<void>; command: (cmd: string, kind?: 'survival' | 'tests') => Promise<void>; unlock: (password: string) => Promise<boolean>; lock: () => Promise<boolean>; publishPack: (manifest: unknown) => Promise<unknown>; publishWorld: () => Promise<AppStatus>;
      backups: (kind?: 'survival' | 'tests') => Promise<BackupEntry[]>; restore: (name: string, kind?: 'survival' | 'tests') => Promise<{ archived: string; hash: string | null; kind: BackupKind }>; copyIp: () => Promise<string | null>; copyText: (text: string) => Promise<boolean>; recovery: () => Promise<unknown>; checkUpdate: () => Promise<AppStatus>; installUpdate: () => Promise<AppStatus>;
      config: { get: () => Promise<AppConfig>; save: (value: AppConfig) => Promise<AppStatus> };
      onLog: (listener: (line: string) => void) => void; onServerState: (listener: (state: any) => void) => void; onUpdateState: (listener: (state: UpdateState) => void) => void;
    };
  }
  type Player = { name: string; discordId: string };
  type RepoRef = { owner: string; repo: string; branch?: string };
  type AppConfig = { playerName: string; isAdmin: boolean; discordBotToken?: string; discordChannelId?: string; discordGuildId?: string; releasesChannelId?: string; trackerDataPath?: string; githubToken?: string; adminPassword?: string; adminDiscordId?: string; manualLauncher?: boolean; clientInstancePath?: string; radminPath?: string; packRepo: RepoRef; coordinationRepo: RepoRef; driveRoot: string; multiMcPath: string; multiMcInstance: string; javaPath: string; serverJar: string; serverMemoryMb: number; port: number; players: Player[]; backupIntervalMinutes: number; backupRetention: number; fullBackupRetention: number; testDriveRoot: string; testPort: number; testMultiMcInstance: string; testServerJar: string; testServerMemoryMb: number; testBackupIntervalMinutes: number; testBackupRetention: number; timeZone: string };
  type BackupKind = 'incremental' | 'completo';
  type BackupEntry = { name: string; kind: BackupKind; createdAt: string; files: number; bytes: number; addedBytes?: number };
  type Lease = { hostName: string; ip: string; port: number; heartbeatAt: string; packVersion: string };
  type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';
  type HostStatus = { kind: 'survival' | 'tests'; requirements: Requirement[]; lease: Lease | null; localWorldHash: string | null; publishedWorldHash: string | null; server: ServerState; driveRoot: string; port: number; instance: string; hasWorld: boolean };
  type Requirement = { name: string; ok: boolean; detail: string };
  type UpdateState = { phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error'; version?: string; percent?: number; detail?: string; message?: string };
  type AppStatus = { requirements: Requirement[]; lease: Lease | null; localWorldHash: string | null; publishedWorldHash: string | null; radminIp: string | null; server: ServerState; logs: string[]; consoleUnlocked: boolean; hasAdminSecret: boolean; version: string; update: UpdateState; hosts?: HostStatus[] };
  type PackManifest = { version: string };
}
