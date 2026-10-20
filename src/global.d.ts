export {};
declare module '*.css';
declare global {
  interface Window {
    lantern: {
      status: () => Promise<AppStatus>; sync: () => Promise<{ manifest: PackManifest; status: AppStatus }>; start: () => Promise<AppStatus>; stop: () => Promise<AppStatus>; join: () => Promise<void>; command: (cmd: string) => Promise<void>; unlock: (password: string) => Promise<boolean>; lock: () => Promise<boolean>; publishPack: (manifest: unknown) => Promise<unknown>; publishWorld: () => Promise<AppStatus>;
      backups: () => Promise<BackupEntry[]>; restore: (name: string) => Promise<{ archived: string; hash: string | null; kind: BackupKind }>; copyIp: () => Promise<string | null>; copyText: (text: string) => Promise<boolean>; recovery: () => Promise<unknown>; checkUpdate: () => Promise<AppStatus>; installUpdate: () => Promise<AppStatus>;
      config: { get: () => Promise<AppConfig>; save: (value: AppConfig) => Promise<AppStatus> };
      onLog: (listener: (line: string) => void) => void; onServerState: (listener: (state: string) => void) => void; onUpdateState: (listener: (state: UpdateState) => void) => void;
    };
  }
  type Player = { name: string; discordId: string };
  type RepoRef = { owner: string; repo: string; branch?: string };
  type AppConfig = { playerName: string; isAdmin: boolean; discordBotToken?: string; discordChannelId?: string; discordGuildId?: string; releasesChannelId?: string; trackerDataPath?: string; githubToken?: string; adminPassword?: string; adminDiscordId?: string; manualLauncher?: boolean; clientInstancePath?: string; radminPath?: string; packRepo: RepoRef; coordinationRepo: RepoRef; driveRoot: string; multiMcPath: string; multiMcInstance: string; javaPath: string; serverJar: string; serverMemoryMb: number; port: number; players: Player[]; backupIntervalMinutes: number; backupRetention: number; fullBackupRetention: number; timeZone: string };
  type BackupKind = 'incremental' | 'completo';
  type BackupEntry = { name: string; kind: BackupKind; createdAt: string; files: number; bytes: number; addedBytes?: number };
  type Lease = { hostName: string; ip: string; port: number; heartbeatAt: string; packVersion: string };
  type Requirement = { name: string; ok: boolean; detail: string };
  type UpdateState = { phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error'; version?: string; percent?: number; detail?: string; message?: string };
  type AppStatus = { requirements: Requirement[]; lease: Lease | null; localWorldHash: string | null; publishedWorldHash: string | null; radminIp: string | null; server: string; logs: string[]; consoleUnlocked: boolean; hasAdminSecret: boolean; version: string; update: UpdateState };
  type PackManifest = { version: string };
}
