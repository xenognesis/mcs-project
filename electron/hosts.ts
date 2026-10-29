import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GitHubClient, isStale } from './github';
import { publishManifest, syncPack } from './pack';
import { MinecraftServer } from './server';
import type { AppConfig, BackupEntry, HostKind, HostStatus, Lease, PackManifest } from './types';
import { archiveThenRestore, copyWorld, hashDirectory, listBackups, publishWorldState, readPublishedHash, resolveTestDriveRoot, snapshot, worldPaths } from './world';

export type HostContext = {
  kind: HostKind;
  driveRoot: string;
  port: number;
  instance: string;
  serverJar: string;
  memoryMb: number;
  packFile: string;
  leaseFile: string;
  retention: number;
  fullRetention: number;
  intervalMinutes: number;
};

export class HostManager {
  private servers = new Map<HostKind, MinecraftServer>();
  private starting = new Set<HostKind>();
  private copyingTestsWorld = false;
  private sessions = new Map<HostKind, string>();
  private heartbeats = new Map<HostKind, NodeJS.Timeout>();
  private backups = new Map<HostKind, NodeJS.Timeout>();

  constructor(
    private config: AppConfig,
    private appendLog: (line: string) => void,
    private send: (channel: string, payload: unknown) => void,
    private ensureRadmin: () => Promise<boolean>,
    private findIp: () => string | null,
    private launchMc: (address: string, kind: HostKind) => void,
    private copyIp: (address: string) => void,
    private notify: (msg: string) => Promise<void>,
    private isUnlocked: () => boolean
  ) {
    this.servers.set('survival', new MinecraftServer(appendLog, (state) => send('server-state', { kind: 'survival', state })));
    this.servers.set('tests', new MinecraftServer(appendLog, (state) => send('server-state', { kind: 'tests', state })));
  }

  updateConfig(config: AppConfig) { this.config = config; }

  private ctx(kind: HostKind): HostContext {
    if (kind === 'survival') {
      return {
        kind: 'survival',
        driveRoot: this.config.driveRoot,
        port: this.config.port,
        instance: this.config.multiMcInstance,
        serverJar: this.config.serverJar,
        memoryMb: this.config.serverMemoryMb,
        packFile: 'manifest.json',
        leaseFile: 'server-status.json',
        retention: this.config.backupRetention,
        fullRetention: this.config.fullBackupRetention,
        intervalMinutes: this.config.backupIntervalMinutes
      };
    }
    const driveRoot = resolveTestDriveRoot(this.config);
    const memoryMb = this.config.testServerMemoryMb && this.config.testServerMemoryMb > 0 ? this.config.testServerMemoryMb : this.config.serverMemoryMb;
    const interval = this.config.testBackupIntervalMinutes && this.config.testBackupIntervalMinutes > 0 ? this.config.testBackupIntervalMinutes : this.config.backupIntervalMinutes;
    return {
      kind: 'tests',
      driveRoot,
      port: this.config.testPort || 25566,
      instance: this.config.testMultiMcInstance || 'MCS-TESTS',
      serverJar: this.config.testServerJar || this.config.serverJar,
      memoryMb,
      packFile: 'manifest-tests.json',
      leaseFile: 'server-status-tests.json',
      retention: Math.max(1, this.config.testBackupRetention || 1),
      fullRetention: 0,
      intervalMinutes: Math.max(5, interval)
    };
  }

  private server(kind: HostKind) { return this.servers.get(kind)!; }
  private session(kind: HostKind) { return this.sessions.get(kind) ?? null; }

  async status(kind: HostKind): Promise<HostStatus> {
    const ctx = this.ctx(kind);
    const published = ctx.driveRoot ? await readPublishedHash(ctx.driveRoot) : null;
    const srv = this.server(kind);
    const hasWorld = Boolean(ctx.driveRoot) && existsSync(worldPaths(ctx.driveRoot).world);
    // Sólo survival necesita el hash para compararlo con la instantánea publicada.
    // Hashear el mundo de pruebas (Drive) en cada refresco bloqueaba la interfaz y el detener.
    const local = kind === 'survival' && ctx.driveRoot && srv.status === 'stopped'
      ? await hashDirectory(worldPaths(ctx.driveRoot).world)
      : published;
    // Un problema de red no debe ocultar el estado del servidor local (por ejemplo, el propio host).
    let lease: Lease | null = null;
    if (this.config.githubToken) {
      try {
        const leaseResult = await new GitHubClient(this.config.githubToken).getJson<Lease>(this.config.coordinationRepo, ctx.leaseFile);
        if (leaseResult?.value && Date.now() - Date.parse(leaseResult.value.heartbeatAt) <= 3 * 60_000) lease = leaseResult.value;
      } catch { /* sin coordinación: seguimos mostrando lo local */ }
    }
    return {
      kind,
      requirements: [],
      lease,
      localWorldHash: local,
      publishedWorldHash: published,
      server: srv.status,
      driveRoot: ctx.driveRoot,
      port: ctx.port,
      instance: ctx.instance,
      hasWorld
    };
  }

  async start(kind: HostKind, requireLatest: () => Promise<void>) {
    if (kind === 'tests' && this.copyingTestsWorld) {
      throw new Error('Esperá a que termine la copia del mundo survival y la sincronización.');
    }
    if (this.starting.has(kind) || this.server(kind).status !== 'stopped') {
      throw new Error(kind === 'tests' ? 'El servidor de pruebas ya está iniciado.' : 'El servidor survival ya está iniciado.');
    }
    this.starting.add(kind);
    try { await this.startInternal(kind, requireLatest); }
    finally { this.starting.delete(kind); }
  }

  private async startInternal(kind: HostKind, requireLatest: () => Promise<void>) {
    const ctx = this.ctx(kind);
    await requireLatest();
    const ready = await this.ensureRadmin();
    if (!ready) throw new Error('No se pudo encender Radmin VPN automáticamente.');
    await mkdir(ctx.driveRoot, { recursive: true });
    if (kind === 'tests') {
      // La copia de reemplazo se hace con el botón "Copiar mundo survival". Sólo el primer
      // inicio (sin mundo de pruebas) copia automáticamente, porque no hay nada que reemplazar.
      const wp = worldPaths(ctx.driveRoot);
      if (!existsSync(wp.world)) {
        try { await copyWorld(this.config.driveRoot, ctx.driveRoot); this.appendLog('[Pruebas] Mundo copiado desde survival (primer inicio).'); }
        catch (e) { this.appendLog(`[Pruebas] No se pudo copiar mundo: ${(e as Error).message}`); }
      }
    }
    let manifest = await syncPack(this.config, this.appendLog, { kind, driveRoot: ctx.driveRoot, instance: ctx.instance });
    if (kind === 'tests') {
      if (this.config.testServerJar) manifest.serverJar = this.config.testServerJar;
      else if (!manifest.serverJar) {
        // Fallback to survival jar if tests manifest doesn't specify
        manifest.serverJar = this.config.serverJar;
      }
    }
    const ip = this.findIp(); if (!ip) throw new Error('Radmin VPN no está disponible.');
    const github = new GitHubClient(this.config.githubToken ?? '');
    const sid = randomUUID();
    const lease: Lease = { sessionId: sid, hostName: this.config.playerName, ip, port: ctx.port, packVersion: manifest.version, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    if (!await github.acquireLease(this.config.coordinationRepo, lease, ctx.leaseFile)) {
      let detail = '';
      try {
        const current = await github.getJson<Lease>(this.config.coordinationRepo, ctx.leaseFile);
        if (current?.value) {
          const since = new Intl.DateTimeFormat('es-AR', { timeStyle: 'short', timeZone: this.config.timeZone }).format(new Date(current.value.startedAt));
          detail = ` Lo mantiene ${current.value.hostName} en ${current.value.ip}:${current.value.port} desde las ${since}.`;
        }
      } catch { /* el detalle es opcional */ }
      throw new Error(`Otro jugador ya mantiene ese servidor activo.${detail}`);
    }
    this.sessions.set(kind, sid);
    try {
      const srvConfig = { ...this.config, driveRoot: ctx.driveRoot, port: ctx.port, serverJar: manifest.serverJar || ctx.serverJar, serverMemoryMb: ctx.memoryMb, multiMcInstance: ctx.instance } as AppConfig;
      await this.server(kind).start(srvConfig, ip);
      this.heartbeats.set(kind, setInterval(async () => {
        const s = this.sessions.get(kind); if (!s) return;
        const renewed = { ...lease, heartbeatAt: new Date().toISOString() };
        try { await github.renewLease(this.config.coordinationRepo, s, renewed, ctx.leaseFile); } catch { /* ignore */ }
      }, 30_000));
      this.backups.set(kind, setInterval(() => void this.server(kind).backupBarrier(async () => {
        if (kind === 'tests') {
          // Only 1 hourly backup for tests as requested
          const backup = await snapshot(ctx.driveRoot, 'hourly', ctx.retention, 0, this.config.timeZone);
          this.appendLog(`[Pruebas] Backup ${backup.name} creado (incremental).`);
        } else {
          const backup = await snapshot(ctx.driveRoot, 'hourly', ctx.retention, ctx.fullRetention, this.config.timeZone);
          this.appendLog(`Backup ${backup.name} creado (incremental: ${backup.files} archivos).`);
        }
      }).catch((e) => this.appendLog(`No se pudo crear backup: ${(e as Error).message}`)), ctx.intervalMinutes * 60_000));
      if (kind === 'survival') {
        try { await this.notify(`${this.config.playerName} abrió el servidor a las ${new Intl.DateTimeFormat('es-AR', { timeStyle: 'short', timeZone: this.config.timeZone }).format(new Date())}`); } catch { /* ignore */ }
      }
      if (this.config.manualLauncher) this.copyIp(`${ip}:${ctx.port}`); else this.launchMc(`${ip}:${ctx.port}`, kind);
    } catch (e) {
      await this.stop(kind).catch(() => undefined);
      throw e;
    }
  }

  async stop(kind: HostKind) {
    const sid = this.sessions.get(kind);
    const ctx = this.ctx(kind);
    const hb = this.heartbeats.get(kind); if (hb) clearInterval(hb); this.heartbeats.delete(kind);
    const b = this.backups.get(kind); if (b) clearInterval(b); this.backups.delete(kind);
    const github = new GitHubClient(this.config.githubToken ?? '');
    try {
      await this.server(kind).stop();
      // El mundo de pruebas es descartable y ya tiene backups periódicos. Un snapshot
      // completo acá mantenía el botón "Detener" bloqueado varios minutos sobre Drive.
      // Survival sí necesita su backup completo de cierre antes de liberar el lease.
      if (kind === 'survival') {
        try {
          const backup = await snapshot(ctx.driveRoot, 'shutdown', ctx.retention, ctx.fullRetention, this.config.timeZone);
          await publishWorldState(ctx.driveRoot, this.config.playerName);
          try { await this.notify(`${this.config.playerName} cerró el servidor.`); } catch { /* ignore */ }
        } catch { /* ignore */ }
      }
    } finally {
      if (sid) {
        try { await github.releaseLease(this.config.coordinationRepo, sid, ctx.leaseFile); } catch { /* ignore */ }
        this.sessions.delete(kind);
      }
    }
  }

  isHost(kind: HostKind) { return this.server(kind).status !== 'stopped' || !!this.sessions.get(kind); }
  statusOf(kind: HostKind) { return this.server(kind).status; }
  command(kind: HostKind, command: string) { this.server(kind).command(command); }

  /** Crea un backup incremental inmediatamente, sin esperar al intervalo configurado. */
  async createHourlyBackup(kind: HostKind): Promise<BackupEntry> {
    if (this.server(kind).status !== 'running') {
      throw new Error(kind === 'tests' ? 'El servidor de pruebas no está iniciado.' : 'El servidor survival no está iniciado.');
    }
    const ctx = this.ctx(kind);
    let backup!: BackupEntry;
    await this.server(kind).backupBarrier(async () => {
      backup = await snapshot(ctx.driveRoot, 'hourly', ctx.retention, ctx.fullRetention, this.config.timeZone);
    });
    this.appendLog(kind === 'tests'
      ? `[Pruebas] Backup manual ${backup.name} creado (incremental).`
      : `Backup manual ${backup.name} creado (incremental: ${backup.files} archivos).`);
    return backup;
  }
  isCopyingTestsWorld() { return this.copyingTestsWorld; }
  async copyTestsWorldFromSurvival() {
    if (this.copyingTestsWorld) throw new Error('Ya hay una copia en curso.');
    if (this.server('tests').status !== 'stopped' || this.sessions.has('tests')) throw new Error('Detené el servidor de pruebas antes de copiar el mundo.');
    if (this.starting.has('tests')) throw new Error('No se puede copiar mientras se está iniciando el servidor de pruebas.');
    const ctx = this.ctx('tests');
    if (!this.config.driveRoot) throw new Error('Configurá la carpeta de Google Drive de survival antes de copiar.');
    this.copyingTestsWorld = true;
    try {
      if (this.config.githubToken) {
        try {
          const current = await new GitHubClient(this.config.githubToken).getJson<Lease>(this.config.coordinationRepo, ctx.leaseFile);
          if (current?.value && !isStale(current.value)) {
            throw new Error(`El servidor de pruebas lo está usando ${current.value.hostName}. Pedile que lo detenga antes de copiar.`);
          }
        } catch (error) {
          // Si el error es el del host activo, se propaga; un fallo de red sólo se registra.
          if (error instanceof Error && error.message.startsWith('El servidor de pruebas lo está usando')) throw error;
          this.appendLog(`[Pruebas] No se pudo verificar si hay otro host de pruebas: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await mkdir(ctx.driveRoot, { recursive: true });
      await copyWorld(this.config.driveRoot, ctx.driveRoot);
      this.appendLog('[Pruebas] Mundo survival copiado al mundo de pruebas. Sincronizando pack…');
      await syncPack(this.config, this.appendLog, { kind: 'tests', driveRoot: ctx.driveRoot, instance: ctx.instance });
    } finally {
      this.copyingTestsWorld = false;
    }
  }
}
