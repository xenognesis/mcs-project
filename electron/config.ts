import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './types';

const defaults: AppConfig = {
  playerName: '', isAdmin: false, discordBotToken: '', discordChannelId: '', discordGuildId: '', trackerDataPath: '', githubToken: '',
  adminPassword: '', adminDiscordId: '', manualLauncher: false, clientInstancePath: '', radminPath: '',
  packRepo: { owner: '', repo: 'minecraft-pack', branch: 'main' },
  coordinationRepo: { owner: '', repo: 'minecraft-coordination', branch: 'main' },
  driveRoot: '', multiMcPath: '', multiMcInstance: 'shared-server', javaPath: 'java', serverJar: 'server.jar',
  serverMemoryMb: 4096, port: 25565, players: [], backupIntervalMinutes: 60, backupRetention: 20,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
};

type Persisted = Omit<AppConfig, 'githubToken' | 'discordBotToken' | 'adminPassword'> & {
  githubToken?: string;
  discordBotToken?: string;
  adminPassword?: string;
};
export class ConfigStore {
  private file = path.join(app.getPath('userData'), 'config.json');
  async load(): Promise<AppConfig> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as Persisted;
      return {
        ...defaults,
        ...saved,
        githubToken: this.decrypt(saved.githubToken),
        discordBotToken: this.decrypt(saved.discordBotToken),
        adminPassword: this.decrypt(saved.adminPassword)
      };
    } catch { return { ...defaults }; }
  }
  async save(config: AppConfig) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const stored: Persisted = {
      ...config,
      githubToken: this.encrypt(config.githubToken),
      discordBotToken: this.encrypt(config.discordBotToken),
      adminPassword: this.encrypt(config.adminPassword)
    };
    await writeFile(this.file, JSON.stringify(stored, null, 2), 'utf8');
  }
  private encrypt(value?: string) {
    if (!value) return '';
    return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : value;
  }
  private decrypt(value?: string) {
    if (!value) return '';
    try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : value; } catch { return ''; }
  }
}
