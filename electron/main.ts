import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigStore } from './config';
import { notifyPlayers, startDiscordBot, stopDiscordBot } from './discord';
import { GitHubClient, isStale } from './github';
import { HostManager } from './hosts';
import { findRadminIp, canReach, radminExeCandidates } from './network';
import { publishManifest, syncPack } from './pack';
import { runRadminPower } from './radmin';
import { noticeReleaseOnce, type ReleaseNotice } from './releases';
import { hasStoredAdminSecret, isSessionUnlocked, saveAdminSecret, setSessionUnlocked, tryAutoUnlock, verifyAdminPassword } from './security';
import type { AppConfig, AppStatus, HostKind, HostStatus, Lease, PackManifest, UpdateState } from './types';
import { createUpdater, type Updater } from './updater';
import { archiveThenRestore, hashDirectory, listBackups, publishWorldState, readPublishedHash, resolveTestDriveRoot, snapshot, worldPaths } from './world';

const UPDATE_REPO = { owner: 'xenognesis', repo: 'mcs-project' };

let window: BrowserWindow | null = null;
const configStore = new ConfigStore();
let config: AppConfig;
let isQuitting = false;
let updater: Updater | null = null;
let announcedRelease: string | null = null;
const logs: string[] = [];

const send = (channel: string, payload: unknown) => {
  try {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  } catch { /* ignore */ }
};
const appendLog = (line: string) => { logs.push(`${new Date().toLocaleTimeString()}  ${line}`); if (logs.length > 300) logs.shift(); send('log', logs.at(-1)); };
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;

process.on('uncaughtException', (error) => appendLog(`[Error] ${error instanceof Error ? error.message : String(error)}`));
process.on('unhandledRejection', (reason) => appendLog(`[Error] ${reason instanceof Error ? reason.message : String(reason)}`));

function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 800, minWidth: 960, minHeight: 650, backgroundColor: '#12221d', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) window.loadURL(url); else window.loadFile(path.join(__dirname, '../dist/index.html'));
}

function resolveRadminExe(): string | null {
  const custom = config.radminPath?.trim().replace(/^"|"$/g, '');
  if (custom && existsSync(custom)) return custom;
  return radminExeCandidates().find((candidate) => existsSync(candidate)) ?? null;
}
function isRadminGuiRunning(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { execFile } = require('node:child_process');
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { windowsHide: true }, (error: any, stdout: string) => {
      resolve(!error && stdout.toLowerCase().includes(image.toLowerCase()));
    });
  });
}
async function ensureRadminVpn(timeoutMs = 20_000): Promise<boolean> {
  const exe = resolveRadminExe();
  if (!exe) {
    if (findRadminIp()) return true;
    appendLog('[Radmin] No se encontró Radmin VPN: indicá la ruta del ejecutable en Configuración.');
    return false;
  }
  if (!await isRadminGuiRunning(path.basename(exe))) {
    appendLog('[Radmin] Encendiendo Radmin VPN…');
    try { const { spawn } = require('node:child_process'); spawn(exe, ['/show'], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref(); } catch (error: any) { appendLog(`[Radmin] No se pudo abrir: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const state = await runRadminPower('ensure', { windowWaitMs: timeoutMs, connectWaitMs: timeoutMs });
  if (state === 'on') { appendLog('[Radmin] VPN en línea.'); return true; }
  if (state === 'off' || state === 'timeout') { appendLog('[Radmin] No se pudo encender la VPN automáticamente.'); return false; }
  appendLog(`[Radmin] No se pudo verificar el encendido (${state}).`);
  return Boolean(findRadminIp());
}
function getCfg(): AppConfig { return config; }

const releaseNoticeFile = () => path.join(app.getPath('userData'), 'release-notified.json');
const SHARED_RELEASE_NOTICE = 'release-announced.json';
async function releaseAlreadyNoticed(version: string): Promise<boolean> {
  if (announcedRelease === null) {
    try { announcedRelease = (JSON.parse(await readFile(releaseNoticeFile(), 'utf8')) as { version?: string }).version ?? ''; }
    catch { announcedRelease = ''; }
  }
  if (announcedRelease === version) return true;
  if (!config.githubToken || !config.coordinationRepo.owner) return false;
  try {
    const remote = await new GitHubClient(config.githubToken).getJson<{ version?: string }>(config.coordinationRepo, SHARED_RELEASE_NOTICE);
    return remote?.value?.version === version;
  } catch { return false; }
}
async function rememberReleaseNotice(notice: ReleaseNotice) {
  announcedRelease = notice.version;
  try { await writeFile(releaseNoticeFile(), JSON.stringify({ version: notice.version }), 'utf8'); } catch { /* ignore */ }
  if (!config.githubToken || !config.coordinationRepo.owner) return;
  try {
    const github = new GitHubClient(config.githubToken);
    const current = await github.getJson<{ version?: string }>(config.coordinationRepo, SHARED_RELEASE_NOTICE);
    await github.putJson(config.coordinationRepo, SHARED_RELEASE_NOTICE, notice, current?.sha, `Announce release ${notice.version}`);
  } catch (error: any) {
    appendLog(`[Versión] No se pudo registrar el aviso compartido: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function noticeRelease(state: UpdateState) {
  if (state.phase !== 'available' || !state.version) return;
  await noticeReleaseOnce({
    token: config.discordBotToken?.trim() ?? '',
    channelId: config.releasesChannelId?.trim() ?? '',
    version: state.version,
    by: config.playerName,
    alreadyNoticed: releaseAlreadyNoticed,
    remember: rememberReleaseNotice,
    log: appendLog
  });
}
async function requireLatestVersion() {
  const gate = await updater?.ensureLatest();
  if (gate && !gate.proceed) throw new Error(gate.message);
}

let hosts: HostManager;
function initHosts() {
  const c = getCfg();
  hosts = new HostManager(
    c as any,
    appendLog,
    send,
    ensureRadminVpn,
    findRadminIp,
    (address: string, kind: HostKind) => {
      const current = getCfg();
      if (current.manualLauncher) clipboard.writeText(address); else {
        const { spawn } = require('node:child_process');
        const instance = kind === 'tests' ? (current.testMultiMcInstance || 'MCS-TESTS') : current.multiMcInstance;
        const child = spawn(current.multiMcPath, ['--launch', instance, '--server', address], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
      }
    },
    (address: string) => clipboard.writeText(address),
    async (msg: string) => {
      const current = getCfg();
      await notifyPlayers(current.discordBotToken ?? '', (current.players || []).filter((p: any) => p.name !== current.playerName), msg, current.discordChannelId);
    },
    () => isSessionUnlocked()
  );
}

/** Host que está alojando este equipo, si hay alguno. */
function runningHost(): HostKind | null {
  if (hosts.statusOf('survival') === 'running') return 'survival';
  if (hosts.statusOf('tests') === 'running') return 'tests';
  return null;
}

/**
 * El bot se conecta sólo mientras este equipo aloja un servidor, para que varias
 * PCs no compitan por la misma sesión de Discord. /hbackup usa este mismo bot.
 */
async function startBotIfHosting() {
  if (!runningHost() || !config.discordBotToken?.trim()) return;
  await startDiscordBot({
    token: config.discordBotToken.trim(),
    adminDiscordId: config.adminDiscordId,
    channelId: config.discordChannelId,
    guildId: config.discordGuildId,
    driveRoot: config.driveRoot,
    trackerDataPath: config.trackerDataPath,
    players: config.players,
    onCommand: (command) => { const kind = runningHost(); if (kind) hosts.command(kind, command); },
    onBackup: () => {
      const kind = runningHost();
      if (!kind) throw new Error('No hay un servidor iniciado.');
      return hosts.createHourlyBackup(kind);
    },
    onLog: appendLog
  });
}

function stopBotIfNoHost() {
  if (hosts.statusOf('survival') === 'stopped' && hosts.statusOf('tests') === 'stopped') stopDiscordBot();
}

async function status(): Promise<AppStatus> {
  const hasAdminSecret = config.driveRoot ? await hasStoredAdminSecret(config.driveRoot) : false;
  if (!isSessionUnlocked() && config.driveRoot && config.isAdmin && config.adminPassword) {
    await tryAutoUnlock(config.driveRoot, config.adminPassword);
  }
  const consoleUnlocked = isSessionUnlocked();
  const requirements = [
    { name: 'Jugador local', ok: Boolean(config.playerName), detail: config.playerName || 'Elegí tu nombre.' },
    { name: 'GitHub', ok: Boolean(config.githubToken && config.packRepo.owner && config.coordinationRepo.owner), detail: config.githubToken ? 'Token configurado' : 'Falta token o repositorios.' },
    { name: 'Google Drive', ok: Boolean(config.driveRoot), detail: config.driveRoot || 'Elegí la carpeta compartida.' },
    config.manualLauncher ? { name: 'Launcher', ok: true, detail: 'Modo manual: la IP se copia al portapapeles y el juego se abre a mano.' } : { name: 'MultiMC', ok: Boolean(config.multiMcPath), detail: config.multiMcPath || 'Indicá MultiMC.exe.' },
    { name: 'Radmin VPN', ok: Boolean(findRadminIp()), detail: findRadminIp() ?? 'Apagado: se encenderá automáticamente al iniciar o unirse.' }
  ];
  // Un error leyendo un host no debe ocultar el estado del otro.
  const hostList: HostStatus[] = [];
  for (const kind of ['survival', 'tests'] as HostKind[]) {
    try { hostList.push(await hosts.status(kind)); }
    catch (error) { appendLog(`[Estado] No se pudo leer el servidor ${kind}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Los campos "sueltos" siguen siendo los de survival para las pantallas heredadas.
  const survival = hostList.find((host) => host.kind === 'survival');
  return {
    requirements,
    lease: survival?.lease ?? null,
    localWorldHash: survival?.localWorldHash ?? null,
    publishedWorldHash: survival?.publishedWorldHash ?? null,
    radminIp: findRadminIp(),
    server: survival?.server ?? 'stopped',
    logs,
    consoleUnlocked,
    hasAdminSecret,
    version: app.getVersion(),
    update: updater?.state() ?? { phase: 'idle' },
    hosts: hostList
  };
}

function assertWorldSynced(local: string | null, published: string | null) {
  if (!local && !published) return;
  if (!local || !published || local !== published) throw new Error('El mundo local no coincide con la instantánea publicada. Si reemplazaste el mundo a propósito, publicá el estado actual desde el botón "Publicar mundo actual"; si no, sincronizá Google Drive o restaurá una copia antes de iniciar.');
}
async function publishWorldIfChanged(reason: string) {
  if (!config.driveRoot) return;
  const local = await hashDirectory(worldPaths(config.driveRoot).world);
  const published = await readPublishedHash(config.driveRoot);
  if (local && local !== published) {
    const hash = await publishWorldState(config.driveRoot, config.playerName || 'Admin');
    appendLog(`[Mundo] Estado republicado (${reason}): ${hash.slice(0, 12)}.`);
  }
}

app.whenReady().then(async () => {
  config = await configStore.load();
  initHosts();
  (hosts as any).updateConfig?.(config);
  if (config.driveRoot && config.isAdmin && config.adminPassword) {
    await tryAutoUnlock(config.driveRoot, config.adminPassword);
  }
  createWindow();
  ipcMain.handle('status', status);
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', async (_event, input: AppConfig) => {
    config = input;
    if (hosts) (hosts as any).updateConfig?.(config);
    if (config.driveRoot && config.adminPassword) {
      await saveAdminSecret(config.driveRoot, config.adminPassword);
    }
    await configStore.save(config);
    // Refresca el bot con la configuración nueva si este equipo está alojando.
    if (runningHost()) { stopDiscordBot(); await startBotIfHosting(); }
    return status();
  });
  ipcMain.handle('sync', async (_e, kind?: HostKind) => {
    const k = kind ?? 'survival';
    const driveRoot = k === 'tests' ? resolveTestDriveRoot(config) : config.driveRoot;
    const instance = k === 'tests' ? config.testMultiMcInstance : config.multiMcInstance;
    const manifest = await syncPack(config, appendLog, { kind: k, driveRoot, instance });
    return { manifest, status: await status() };
  });
  ipcMain.handle('pack:publish', async (_event, manifest: PackManifest) => { await publishManifest(config, manifest); return manifest; });
  ipcMain.handle('world:publish', async () => {
    if (hosts.statusOf('survival') !== 'stopped') throw new Error('Detené el servidor antes de publicar el estado del mundo.');
    if (!config.driveRoot) throw new Error('Configurá la carpeta compartida de Google Drive antes de publicar el mundo.');
    if (!isSessionUnlocked()) throw new Error('Se requiere la clave maestra de administrador. Desbloqueá la consola y volvé a intentar.');
    const hash = await publishWorldState(config.driveRoot, config.playerName || 'Admin');
    appendLog(`[Mundo] Estado actual publicado manualmente (hash ${hash.slice(0, 12)}).`);
    return status();
  });
  ipcMain.handle('worlds:copy-tests-from-survival', async () => {
    if (!hosts) throw new Error('No hay gestor de servidores.');
    await hosts.copyTestsWorldFromSurvival();
    return status();
  });
  ipcMain.handle('server:start', async (_e, kind?: HostKind) => {
    const k = kind ?? 'survival';
    await requireLatestVersion();
    await hosts.start(k, requireLatestVersion);
    await startBotIfHosting();
    return status();
  });
  ipcMain.handle('server:stop', async (_e, kind?: HostKind) => {
    const k = kind ?? 'survival';
    await hosts.stop(k);
    stopBotIfNoHost();
    return status();
  });
  ipcMain.handle('server:join', async (_e, kind?: HostKind) => {
    await requireLatestVersion();
    if (!await ensureRadminVpn(12_000)) throw new Error('No se pudo encender Radmin VPN automáticamente.');
    const k = kind ?? 'survival';
    const leaseFile = k === 'tests' ? 'server-status-tests.json' : 'server-status.json';
    const port = k === 'tests' ? (config.testPort || 25566) : config.port;
    const lease = (await new GitHubClient(config.githubToken ?? '').getJson<Lease>(config.coordinationRepo, leaseFile))?.value;
    if (!lease || isStale(lease)) throw new Error('No hay un servidor activo para unirse.');
    if (config.manualLauncher) clipboard.writeText(`${lease.ip}:${lease.port || port}`); else {
      const { spawn } = require('node:child_process');
      const inst = k === 'tests' ? (config.testMultiMcInstance || 'MCS-TESTS') : config.multiMcInstance;
      const child = spawn(config.multiMcPath, ['--launch', inst, '--server', `${lease.ip}:${lease.port || port}`], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
    }
  });
  ipcMain.handle('server:command', (_event, cmd: string, kind?: HostKind) => {
    if (!isSessionUnlocked()) throw new Error('Consola bloqueada: Se requiere la clave de administrador para ejecutar comandos.');
    const clean = cmd.trim().startsWith('/') ? cmd.trim().slice(1).trim() : cmd.trim();
    if (!clean) return;
    hosts.command(kind ?? 'survival', clean);
    appendLog(`> ${clean}`);
  });
  ipcMain.handle('auth:unlock', async (_event, password: string) => {
    const ok = await verifyAdminPassword(config.driveRoot, password);
    if (!ok) throw new Error('Clave incorrecta.');
    setSessionUnlocked(true);
    appendLog('[Seguridad] Consola desbloqueada por el administrador.');
    return true;
  });
  ipcMain.handle('auth:lock', () => { setSessionUnlocked(false); return true; });
  ipcMain.handle('backups:list', (_e, kind?: HostKind) => {
    const k = kind ?? 'survival';
    const driveRoot = k === 'tests' ? resolveTestDriveRoot(config) : config.driveRoot;
    return listBackups(driveRoot);
  });
  ipcMain.handle('backups:restore', async (_event, backup: string, kind?: HostKind) => {
    const k = kind ?? 'survival';
    if (k === 'survival' && hosts.statusOf('survival') !== 'stopped') throw new Error('Detené el servidor antes de restaurar.');
    const driveRoot = k === 'tests' ? resolveTestDriveRoot(config) : config.driveRoot;
    const result = await archiveThenRestore(driveRoot, backup, config.playerName || 'Restauración');
    appendLog(`Backup ${backup} restaurado${result.hash ? ` (hash ${result.hash.slice(0, 12)})` : ''}; versión previa archivada en conflicts.`);
    return result;
  });
  ipcMain.handle('clipboard:copy-ip', () => { const ip = findRadminIp(); if (ip) clipboard.writeText(ip); return ip; });
  ipcMain.handle('clipboard:write', (_event, text: string) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('lease:recover-check', async () => { const lease = (await new GitHubClient(config.githubToken ?? '').getJson<Lease>(config.coordinationRepo, 'server-status.json'))?.value; return lease ? { stale: isStale(lease), reachable: await canReach(lease.ip, lease.port), lease } : null; });
  updater = createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    repo: UPDATE_REPO,
    onState: (state) => { send('update-state', state); void noticeRelease(state); },
    serverRunning: () => {
      return hosts.statusOf('survival') !== 'stopped' || hosts.statusOf('tests') !== 'stopped';
    },
    log: appendLog
  });
  ipcMain.handle('update:check', async () => { await updater?.check(true); return status(); });
  ipcMain.handle('update:install', async () => { if (!updater) throw new Error('El actualizador no está disponible.'); updater.install(); return status(); });
  setTimeout(() => { void updater?.check(false); }, 4000);
  app.on('before-quit', (event) => {
    const surv = hosts.statusOf('survival');
    const tests = hosts.statusOf('tests');
    if (isQuitting || (surv === 'stopped' && tests === 'stopped')) return;
    event.preventDefault(); isQuitting = true;
    void (async () => { try { if (hosts) { await hosts.stop('survival'); await hosts.stop('tests'); } } catch {} })()
      .catch((error: any) => appendLog(`[Cierre] No se pudo cerrar el servidor: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { stopDiscordBot(); app.quit(); });
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
