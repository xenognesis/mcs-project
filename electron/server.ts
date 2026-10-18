import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './types';

// El server.properties vive en la carpeta compartida, así que un `server-ip` fijado
// por el host anterior rompería el arranque en cualquier otra PC. Lo reescribimos con
// la IP de Radmin del host actual para que el bind siempre sea válido.
export async function bindToRadminIp(config: AppConfig, ip: string) {
  const file = path.join(config.driveRoot, 'server.properties');
  let content: string;
  try { content = await readFile(file, 'utf8'); } catch { return; }
  const desired = `server-ip=${ip}`;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let replaced = false;
  const lines = content.split(/\r?\n/).map((line) => {
    if (/^server-ip=/.test(line)) { replaced = true; return desired; }
    return line;
  });
  if (!replaced) lines.push(desired);
  const output = lines.join(eol);
  if (output !== content) await writeFile(file, output, 'utf8');
}

export class MinecraftServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private state: 'stopped' | 'starting' | 'running' | 'stopping' = 'stopped';
  constructor(private readonly onLog: (line: string) => void, private readonly onState: (state: typeof this.state) => void) {}
  get status() { return this.state; }
  async start(config: AppConfig, bindIp?: string) {
    if (this.process) throw new Error('El servidor ya está iniciado.');
    const jar = path.isAbsolute(config.serverJar) ? config.serverJar : path.join(config.driveRoot, config.serverJar);
    await access(jar);
    if (bindIp) await bindToRadminIp(config, bindIp);
    this.setState('starting');
    // El directorio de trabajo siempre es la raíz compartida: Minecraft crea allí
    // world/, mods/, config/ y server.properties, que son los directorios que
    // sincroniza y respalda Lantern.
    const child = spawn(config.javaPath, [`-Xms${Math.min(1024, config.serverMemoryMb)}M`, `-Xmx${config.serverMemoryMb}M`, '-jar', jar, 'nogui'], { cwd: config.driveRoot, windowsHide: true });
    this.process = child;
    let ready = false;
    const receive = (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
        this.onLog(line);
        if (!ready && /Done \(.+\)!|For help, type/i.test(line)) { ready = true; this.setState('running'); }
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('exit', (code) => { this.onLog(`Proceso del servidor finalizó (${code ?? 'sin código'}).`); this.process = null; this.setState('stopped'); });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('El servidor no quedó listo en 90 segundos.')), 90_000);
      const interval = setInterval(() => { if (this.state === 'running') { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 200);
      child.once('error', (error) => { clearInterval(interval); clearTimeout(timeout); reject(error); });
    });
  }
  command(command: string) { if (this.process) this.process.stdin.write(`${command}\n`); }
  async backupBarrier(action: () => Promise<void>) { this.command('save-all flush'); this.command('save-off'); await new Promise((resolve) => setTimeout(resolve, 500)); try { await action(); } finally { this.command('save-on'); } }
  async stop() {
    if (!this.process) return; this.setState('stopping'); this.command('save-all flush'); this.command('stop');
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 30_000); this.process?.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
  private setState(state: typeof this.state) { this.state = state; this.onState(state); }
}
