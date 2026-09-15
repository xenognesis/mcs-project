export {};
declare module '*.css';
declare global {
  interface Window {
    lantern: {
      status: () => Promise<AppStatus>; sync: () => Promise<{ manifest: PackManifest; status: AppStatus }>; start: () => Promise<AppStatus>; stop: () => Promise<AppStatus>; join: () => Promise<void>; publishPack: (manifest: unknown) => Promise<unknown>;
      backups: () => Promise<string[]>; restore: (name: string) => Promise<string>; copyIp: () => Promise<string | null>; recovery: () => Promise<unknown>;
      config: { get: () => Promise<AppConfig>; save: (value: AppConfig) => Promise<AppStatus> };
      onLog: (listener: (line: string) => void) => void; onServerState: (listener: (state: string) => void) => void;
    };
  }
  type Player = { name: string; discordId: string };
  type RepoRef = { owner: string; repo: string; branch?: string };
  type AppConfig = { playerName: string; isAdmin: boolean; discordBotToken?: string; githubToken?: string; packRepo: RepoRef; coordinationRepo: RepoRef; driveRoot: string; multiMcPath: string; multiMcInstance: string; javaPath: string; serverJar: string; serverMemoryMb: number; port: number; players: Player[]; backupIntervalMinutes: number; backupRetention: number; timeZone: string };
  type Lease = { hostName: string; ip: string; port: number; heartbeatAt: string; packVersion: string };
  type Requirement = { name: string; ok: boolean; detail: string };
  type AppStatus = { requirements: Requirement[]; lease: Lease | null; localWorldHash: string | null; publishedWorldHash: string | null; radminIp: string | null; server: string; logs: string[] };
  type PackManifest = { version: string };
}
