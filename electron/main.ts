import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConfigStore } from './config';
import { notifyPlayers, startDiscordBot, stopDiscordBot } from './discord';
import { GitHubClient, isStale } from './github';
import { ensureWrapperScript, setWrapperTarget, wrapperCommandLine, wrapperScriptPath } from './launcher';
import { findRadminIp, canReach } from './network';
import { publishManifest, syncPack } from './pack';
import { MinecraftServer } from './server';
import { hasStoredAdminSecret, isSessionUnlocked, saveAdminSecret, setSessionUnlocked, tryAutoUnlock, verifyAdminPassword } from './security';
import type { AppConfig, AppStatus, GdLauncherInfo, Lease, PackManifest } from './types';
import { createUpdater, type Updater } from './updater';
import { archiveThenRestore, hashDirectory, listBackups, publishWorldState, readPublishedHash, snapshot, worldPaths } from './world';

// Repositorio desde el que la app se actualiza (GitHub Releases del propio proyecto).
const UPDATE_REPO = { owner: 'xenognesis', repo: 'msc-project' };

let window: BrowserWindow | null = null;
const configStore = new ConfigStore();
let config: AppConfig;
let sessionId: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let backups: NodeJS.Timeout | null = null;
let isQuitting = false;
let updater: Updater | null = null;
const logs: string[] = [];
const appendLog = (line: string) => { logs.push(`${new Date().toLocaleTimeString()}  ${line}`); if (logs.length > 300) logs.shift(); window?.webContents.send('log', logs.at(-1)); };
const server = new MinecraftServer(appendLog, (state) => window?.webContents.send('server-state', state));

// GDLauncher: Lantern no puede lanzar una instancia por línea de comandos, así que deja un wrapper
// en disco y mantiene al día la dirección del servidor activo. El wrapper sólo actúa si el usuario
// lo configuró una vez en GDLauncher -> Ajustes -> Custom Commands -> Wrapper Command.
let wrapperReady = false;
let launcherTarget: string | null | undefined;
async function ensureLauncher() { if (wrapperReady) return; await ensureWrapperScript(app.getPath('userData')); wrapperReady = true; }
async function setLauncherTarget(address: string | null) {
  await ensureLauncher();
  if (launcherTarget === address) return;
  await setWrapperTarget(app.getPath('userData'), address);
  launcherTarget = address;
}
async function currentGdLauncher(lease: Lease | null): Promise<GdLauncherInfo> {
  const address = lease ? `${lease.ip}:${lease.port}` : null;
  await setLauncherTarget(address);
  const dir = app.getPath('userData');
  return { script: wrapperScriptPath(dir), command: wrapperCommandLine(dir), target: address };
}

function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 800, minWidth: 960, minHeight: 650, backgroundColor: '#12221d', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) window.loadURL(url); else window.loadFile(path.join(__dirname, '../dist/index.html'));
}
async function currentLease() { return new GitHubClient(config.githubToken ?? '').getJson<Lease>(config.coordinationRepo, 'server-status.json'); }
async function status(): Promise<AppStatus> {
  const publishedWorldHash = config.driveRoot ? await readPublishedHash(config.driveRoot) : null;
  const localWorldHash = config.driveRoot ? (server.status === 'stopped' ? await hashDirectory(worldPaths(config.driveRoot).world) : publishedWorldHash) : null;
  const leaseResult = config.githubToken ? await currentLease() : null;
  const hasAdminSecret = config.driveRoot ? await hasStoredAdminSecret(config.driveRoot) : false;
  if (!isSessionUnlocked() && config.driveRoot && config.isAdmin && config.adminPassword) {
    await tryAutoUnlock(config.driveRoot, config.adminPassword);
  }
  const consoleUnlocked = isSessionUnlocked();
  const lease = leaseResult?.value && !isStale(leaseResult.value) ? leaseResult.value : null;
  const gdLauncher = await currentGdLauncher(lease);
  const requirements = [
    { name: 'Jugador local', ok: Boolean(config.playerName), detail: config.playerName || 'Elegí tu nombre.' },
    { name: 'GitHub', ok: Boolean(config.githubToken && config.packRepo.owner && config.coordinationRepo.owner), detail: config.githubToken ? 'Token configurado' : 'Falta token o repositorios.' },
    { name: 'Google Drive', ok: Boolean(config.driveRoot), detail: config.driveRoot || 'Elegí la carpeta compartida.' },
    config.manualLauncher
      ? { name: 'Launcher', ok: true, detail: 'Modo manual: con el wrapper de GDLauncher el juego entra solo.' }
      : { name: 'MultiMC', ok: Boolean(config.multiMcPath), detail: config.multiMcPath || 'Indicá MultiMC.exe.' },
    { name: 'Radmin VPN', ok: Boolean(findRadminIp()), detail: findRadminIp() ?? 'No se detectó el adaptador Radmin.' }
  ];
  return { requirements, lease, localWorldHash, publishedWorldHash, radminIp: findRadminIp(), server: server.status, logs, consoleUnlocked, hasAdminSecret, gdLauncher, version: app.getVersion(), update: updater?.state() ?? { phase: 'idle' } };
}
function assertWorldSynced(local: string | null, published: string | null) {
  if (!local && !published) return;
  if (!local || !published || local !== published) throw new Error('El mundo local no coincide con la instantánea publicada. Si reemplazaste el mundo a propósito, publicá el estado actual desde el botón "Publicar mundo actual"; si no, sincronizá Google Drive o restaurá una copia antes de iniciar.');
}
// Un arranque que llega a iniciar el servidor puede modificar el mundo (p. ej. level.dat) aunque
// después falle. Como el estado sólo se publica en un cierre limpio, aquí lo republicamos para no
// dejar el mundo bloqueado en el próximo intento.
async function publishWorldIfChanged(reason: string) {
  if (!config.driveRoot) return;
  const local = await hashDirectory(worldPaths(config.driveRoot).world);
  const published = await readPublishedHash(config.driveRoot);
  if (local && local !== published) {
    const hash = await publishWorldState(config.driveRoot, config.playerName || 'Admin');
    appendLog(`[Mundo] Estado republicado (${reason}): ${hash.slice(0, 12)}.`);
  }
}
function launchMultiMc(address: string) {
  const child = require('node:child_process').spawn(config.multiMcPath, ['--launch', config.multiMcInstance, '--server', address], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
}
async function beginServer() {
  const preflight = await status();
  if (preflight.requirements.some((item) => !item.ok)) throw new Error('Completá los requisitos marcados antes de iniciar.');
  assertWorldSynced(preflight.localWorldHash, preflight.publishedWorldHash);
  const manifest = await syncPack(config, appendLog);
  const ip = findRadminIp(); if (!ip) throw new Error('Radmin VPN no está disponible.');
  const github = new GitHubClient(config.githubToken ?? ''); sessionId = randomUUID();
  const lease: Lease = { sessionId, hostName: config.playerName, ip, port: config.port, packVersion: manifest.version, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
  if (!await github.acquireLease(config.coordinationRepo, lease)) { sessionId = null; throw new Error('Otro jugador ya mantiene el servidor activo. Usá “Unirse”.'); }
  try {
    await server.start(config, ip);
    if (config.discordBotToken) {
      void startDiscordBot({
        token: config.discordBotToken,
        adminDiscordId: config.adminDiscordId,
        channelId: config.discordChannelId,
        guildId: config.discordGuildId,
        driveRoot: config.driveRoot,
        trackerDataPath: config.trackerDataPath,
        players: config.players,
        onCommand: (cmd) => server.command(cmd),
        onLog: appendLog
      });
    }
    await notifyPlayers(config.discordBotToken ?? '', config.players.filter((player) => player.name !== config.playerName), `${config.playerName} abrió el servidor a las ${new Intl.DateTimeFormat('es-AR', { timeStyle: 'short', timeZone: config.timeZone }).format(new Date())}`, config.discordChannelId);
    heartbeat = setInterval(async () => { if (!sessionId) return; const renewed = { ...lease, heartbeatAt: new Date().toISOString() }; if (!await github.renewLease(config.coordinationRepo, sessionId, renewed)) appendLog('No se pudo renovar el lease.'); }, 30_000);
    backups = setInterval(() => void server.backupBarrier(async () => { const name = await snapshot(config.driveRoot, 'hourly', config.backupRetention); appendLog(`Backup ${name} creado.`); }), config.backupIntervalMinutes * 60_000);
    await setLauncherTarget(`${ip}:${config.port}`);
    if (config.manualLauncher) {
      clipboard.writeText(`${ip}:${config.port}`);
    } else {
      launchMultiMc(`${ip}:${config.port}`);
    }
  } catch (error) { await server.stop(); stopDiscordBot(); try { await publishWorldIfChanged('arranque fallido'); } catch (publishError) { appendLog(`No se pudo republicar el mundo: ${publishError instanceof Error ? publishError.message : String(publishError)}`); } await github.releaseLease(config.coordinationRepo, sessionId); sessionId = null; throw error; }
}
async function endServer() {
  if (!sessionId) return;
  if (heartbeat) clearInterval(heartbeat); if (backups) clearInterval(backups); heartbeat = backups = null;
  stopDiscordBot();
  const activeSession = sessionId;
  try {
    await server.stop(); const backup = await snapshot(config.driveRoot, 'shutdown', config.backupRetention); await publishWorldState(config.driveRoot, config.playerName);
    await notifyPlayers(config.discordBotToken ?? '', config.players.filter((player) => player.name !== config.playerName), `${config.playerName} cerró el servidor.`, config.discordChannelId);
    appendLog(`Backup final ${backup} creado.`);
  } finally { await new GitHubClient(config.githubToken ?? '').releaseLease(config.coordinationRepo, activeSession); sessionId = null; await setLauncherTarget(null); }
}

app.whenReady().then(async () => {
  config = await configStore.load();
  if (config.driveRoot && config.isAdmin && config.adminPassword) {
    await tryAutoUnlock(config.driveRoot, config.adminPassword);
  }
  createWindow();
  ipcMain.handle('status', status); ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', async (_event, input: AppConfig) => {
    config = input;
    if (config.driveRoot && config.adminPassword) {
      await saveAdminSecret(config.driveRoot, config.adminPassword);
    }
    await configStore.save(config);
    return status();
  });
  ipcMain.handle('sync', async () => { const manifest = await syncPack(config, appendLog); return { manifest, status: await status() }; });
  ipcMain.handle('pack:publish', async (_event, manifest: PackManifest) => { await publishManifest(config, manifest); return manifest; });
  ipcMain.handle('world:publish', async () => {
    if (server.status !== 'stopped') throw new Error('Detené el servidor antes de publicar el estado del mundo.');
    if (!config.driveRoot) throw new Error('Configurá la carpeta compartida de Google Drive antes de publicar el mundo.');
    if (!isSessionUnlocked()) throw new Error('Se requiere la clave maestra de administrador. Desbloqueá la consola y volvé a intentar.');
    const hash = await publishWorldState(config.driveRoot, config.playerName || 'Admin');
    appendLog(`[Mundo] Estado actual publicado manualmente (hash ${hash.slice(0, 12)}).`);
    return status();
  });
  ipcMain.handle('server:start', async () => { await beginServer(); return status(); });
  ipcMain.handle('server:stop', async () => { await endServer(); return status(); });
  ipcMain.handle('server:join', async () => {
    const lease = (await currentLease())?.value;
    if (!lease || isStale(lease)) throw new Error('No hay un servidor activo para unirse.');
    const address = `${lease.ip}:${lease.port}`;
    await setLauncherTarget(address);
    if (config.manualLauncher) {
      clipboard.writeText(address);
    } else {
      launchMultiMc(address);
    }
  });
  ipcMain.handle('server:command', (_event, cmd: string) => {
    if (!isSessionUnlocked()) throw new Error('Consola bloqueada: Se requiere la clave de administrador para ejecutar comandos.');
    const clean = cmd.trim().startsWith('/') ? cmd.trim().slice(1).trim() : cmd.trim();
    if (!clean) return;
    server.command(clean);
    appendLog(`> ${clean}`);
  });
  ipcMain.handle('auth:unlock', async (_event, password: string) => {
    const ok = await verifyAdminPassword(config.driveRoot, password);
    if (!ok) throw new Error('Clave incorrecta.');
    setSessionUnlocked(true);
    appendLog('[Seguridad] Consola desbloqueada por el administrador.');
    return true;
  });
  ipcMain.handle('auth:lock', () => {
    setSessionUnlocked(false);
    return true;
  });
  ipcMain.handle('backups:list', () => listBackups(config.driveRoot));
  ipcMain.handle('backups:restore', async (_event, backup: string) => {
    if (server.status !== 'stopped') throw new Error('Detené el servidor antes de restaurar.');
    const result = await archiveThenRestore(config.driveRoot, backup, config.playerName || 'Restauración');
    appendLog(`Backup ${backup} restaurado; versión previa archivada en conflicts.`);
    return result;
  });
  ipcMain.handle('clipboard:copy-ip', () => { const ip = findRadminIp(); if (ip) clipboard.writeText(ip); return ip; });
  ipcMain.handle('clipboard:write', (_event, text: string) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('lease:recover-check', async () => { const lease = (await currentLease())?.value; return lease ? { stale: isStale(lease), reachable: await canReach(lease.ip, lease.port), lease } : null; });
  updater = createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    repo: UPDATE_REPO,
    token: config.updateToken || config.githubToken || '',
    onState: (state) => window?.webContents.send('update-state', state),
    serverRunning: () => server.status !== 'stopped',
    log: appendLog
  });
  ipcMain.handle('update:check', async () => { await updater?.check(true); return status(); });
  ipcMain.handle('update:install', async () => { if (!updater) throw new Error('El actualizador no está disponible.'); updater.install(); return status(); });
  // Verificación silenciosa al arrancar: si hay una versión nueva se descarga y, con el servidor
  // detenido, la app se reinicia sola para instalarla.
  setTimeout(() => { void updater?.check(false); }, 4000);
  app.on('before-quit', (event) => {
    if (isQuitting || server.status === 'stopped') return;
    event.preventDefault(); isQuitting = true;
    void endServer().finally(() => app.quit());
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
