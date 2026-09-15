import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConfigStore } from './config';
import { notifyPlayers } from './discord';
import { GitHubClient, isStale } from './github';
import { findRadminIp, canReach } from './network';
import { publishManifest, syncPack } from './pack';
import { MinecraftServer } from './server';
import type { AppConfig, AppStatus, Lease, PackManifest } from './types';
import { archiveThenRestore, hashDirectory, listBackups, publishWorldState, readPublishedHash, snapshot, worldPaths } from './world';

let window: BrowserWindow | null = null;
const configStore = new ConfigStore();
let config: AppConfig;
let sessionId: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let backups: NodeJS.Timeout | null = null;
let isQuitting = false;
const logs: string[] = [];
const appendLog = (line: string) => { logs.push(`${new Date().toLocaleTimeString()}  ${line}`); if (logs.length > 300) logs.shift(); window?.webContents.send('log', logs.at(-1)); };
const server = new MinecraftServer(appendLog, (state) => window?.webContents.send('server-state', state));

function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 800, minWidth: 960, minHeight: 650, backgroundColor: '#12221d', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) window.loadURL(url); else window.loadFile(path.join(__dirname, '../dist/index.html'));
}
async function currentLease() { return new GitHubClient(config.githubToken ?? '').getJson<Lease>(config.coordinationRepo, 'server-status.json'); }
async function status(): Promise<AppStatus> {
  const [leaseResult, localWorldHash, publishedWorldHash] = await Promise.all([config.githubToken ? currentLease() : Promise.resolve(null), config.driveRoot ? hashDirectory(worldPaths(config.driveRoot).world) : Promise.resolve(null), config.driveRoot ? readPublishedHash(config.driveRoot) : Promise.resolve(null)]);
  const requirements = [
    { name: 'Jugador local', ok: Boolean(config.playerName), detail: config.playerName || 'Elegí tu nombre.' },
    { name: 'GitHub', ok: Boolean(config.githubToken && config.packRepo.owner && config.coordinationRepo.owner), detail: config.githubToken ? 'Token configurado' : 'Falta token o repositorios.' },
    { name: 'Google Drive', ok: Boolean(config.driveRoot), detail: config.driveRoot || 'Elegí la carpeta compartida.' },
    { name: 'MultiMC', ok: Boolean(config.multiMcPath), detail: config.multiMcPath || 'Indicá MultiMC.exe.' },
    { name: 'Radmin VPN', ok: Boolean(findRadminIp()), detail: findRadminIp() ?? 'No se detectó el adaptador Radmin.' }
  ];
  return { requirements, lease: leaseResult?.value && !isStale(leaseResult.value) ? leaseResult.value : null, localWorldHash, publishedWorldHash, radminIp: findRadminIp(), server: server.status, logs };
}
function assertWorldSynced(local: string | null, published: string | null) {
  if (!local && !published) return;
  if (!local || !published || local !== published) throw new Error('El mundo local no coincide con la instantánea publicada. Sincronizá Google Drive o restaurá una copia antes de iniciar.');
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
    await server.start(config);
    await notifyPlayers(config.discordBotToken ?? '', config.players.filter((player) => player.name !== config.playerName), `${config.playerName} abrió el servidor a las ${new Intl.DateTimeFormat('es-AR', { timeStyle: 'short', timeZone: config.timeZone }).format(new Date())}`);
    heartbeat = setInterval(async () => { if (!sessionId) return; const renewed = { ...lease, heartbeatAt: new Date().toISOString() }; if (!await github.renewLease(config.coordinationRepo, sessionId, renewed)) appendLog('No se pudo renovar el lease.'); }, 30_000);
    backups = setInterval(() => void server.backupBarrier(async () => { const name = await snapshot(config.driveRoot, 'hourly', config.backupRetention); appendLog(`Backup ${name} creado.`); }), config.backupIntervalMinutes * 60_000);
    launchMultiMc(`${ip}:${config.port}`);
  } catch (error) { await server.stop(); await github.releaseLease(config.coordinationRepo, sessionId); sessionId = null; throw error; }
}
async function endServer() {
  if (!sessionId) return;
  if (heartbeat) clearInterval(heartbeat); if (backups) clearInterval(backups); heartbeat = backups = null;
  const activeSession = sessionId;
  try {
    await server.stop(); const backup = await snapshot(config.driveRoot, 'shutdown', config.backupRetention); await publishWorldState(config.driveRoot, config.playerName);
    await notifyPlayers(config.discordBotToken ?? '', config.players.filter((player) => player.name !== config.playerName), `${config.playerName} cerró el servidor.`);
    appendLog(`Backup final ${backup} creado.`);
  } finally { await new GitHubClient(config.githubToken ?? '').releaseLease(config.coordinationRepo, activeSession); sessionId = null; }
}

app.whenReady().then(async () => { config = await configStore.load(); createWindow();
  ipcMain.handle('status', status); ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', async (_event, input: AppConfig) => { config = input; await configStore.save(config); return status(); });
  ipcMain.handle('sync', async () => { const manifest = await syncPack(config, appendLog); return { manifest, status: await status() }; });
  ipcMain.handle('pack:publish', async (_event, manifest: PackManifest) => { await publishManifest(config, manifest); return manifest; });
  ipcMain.handle('server:start', async () => { await beginServer(); return status(); });
  ipcMain.handle('server:stop', async () => { await endServer(); return status(); });
  ipcMain.handle('server:join', async () => { const lease = (await currentLease())?.value; if (!lease || isStale(lease)) throw new Error('No hay un servidor activo para unirse.'); launchMultiMc(`${lease.ip}:${lease.port}`); });
  ipcMain.handle('backups:list', () => listBackups(config.driveRoot));
  ipcMain.handle('backups:restore', async (_event, backup: string) => { if (server.status !== 'stopped') throw new Error('Detené el servidor antes de restaurar.'); return archiveThenRestore(config.driveRoot, backup); });
  ipcMain.handle('clipboard:copy-ip', () => { const ip = findRadminIp(); if (ip) clipboard.writeText(ip); return ip; });
  ipcMain.handle('lease:recover-check', async () => { const lease = (await currentLease())?.value; return lease ? { stale: isStale(lease), reachable: await canReach(lease.ip, lease.port), lease } : null; });
  app.on('before-quit', (event) => {
    if (isQuitting || server.status === 'stopped') return;
    event.preventDefault(); isQuitting = true;
    void endServer().finally(() => app.quit());
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
