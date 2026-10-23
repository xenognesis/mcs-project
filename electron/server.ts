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
  let levelNameSet = false;
  const lines = content.split(/\r?\n/).map((line) => {
    if (/^server-ip=/.test(line)) { replaced = true; return desired; }
    if (/^server-port=/.test(line) && (config as any).port) { return `server-port=${(config as any).port}`; }
    // Lantern administra, copia y respalda siempre `world/`. Si el properties trae otro
    // level-name (por ejemplo "MCS Test"), Minecraft ignora esa carpeta y crea otra.
    if (/^level-name=/.test(line)) { levelNameSet = true; return 'level-name=world'; }
    if (/^white-list=/.test(line) || /^whitelist=/.test(line)) { return 'white-list=false'; }
    return line;
  });
  if (!replaced) lines.push(desired);
  if (!levelNameSet) lines.push('level-name=world');
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
    this.onLog('[Servidor] Iniciando Java…');
    const child = spawn(config.javaPath, [`-Xms${Math.min(1024, config.serverMemoryMb)}M`, `-Xmx${config.serverMemoryMb}M`, '-jar', jar, 'nogui'], { cwd: config.driveRoot, windowsHide: true });
    this.process = child;
    let ready = false;
    // Guardamos las últimas líneas para poder explicar por qué no arrancó (EULA, Java, mods, puerto…)
    // en lugar de devolver sólo un "no quedó listo".
    const tail: string[] = [];
    const excerpt = () => (tail.length ? tail.slice(-3).join(' | ') : 'sin salida del servidor');
    // El stdout llega en chunks arbitrarios: se acumula y se corta por líneas completas para no
    // perder una línea (p. ej. "Done (...)") que quede partida entre dos chunks.
    let buffer = '';
    const receive = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) {
        this.onLog(line);
        tail.push(line); if (tail.length > 30) tail.shift();
        if (!ready && /Done \(.+\)!|For help, type/i.test(line)) { ready = true; this.setState('running'); }
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('exit', (code) => {
      if (buffer.trim()) this.onLog(buffer);
      this.onLog(`Proceso del servidor finalizó (${code ?? 'sin código'}).`);
      this.process = null; this.setState('stopped');
    });
    try {
      await new Promise<void>((resolve, reject) => {
        // Modpacks grandes tardan en cargar desde Drive: damos margen generoso antes de rendirnos.
        const timeout = setTimeout(() => reject(new Error('El servidor no quedó listo en 180 segundos.')), 180_000);
        const interval = setInterval(() => { if (this.state === 'running') { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 200);
        child.once('error', (error) => { clearInterval(interval); clearTimeout(timeout); reject(error); });
        // Si el proceso termina mientras seguimos esperando, no aguardamos el tiempo completo: es un fallo de arranque.
        child.once('exit', (code) => {
          clearInterval(interval); clearTimeout(timeout);
          reject(new Error(ready ? `El servidor finalizó apenas arrancó (código ${code ?? 'sin código'}).` : `El servidor terminó antes de estar listo (código ${code ?? 'sin código'}).`));
        });
      });
    } catch (error) {
      // No dejamos procesos colgados y adjuntamos el motivo real a lo que ya se ve en la bitácora.
      try { child.kill(); } catch { /* ya terminó */ }
      this.process = null; this.setState('stopped');
      const base = error instanceof Error ? error.message : String(error);
      throw new Error(`${base} Últimas líneas: ${excerpt()}`);
    }
  }
  command(command: string) { if (this.process) this.process.stdin.write(`${command}\n`); }
  async backupBarrier(action: () => Promise<void>) { this.command('save-all flush'); this.command('save-off'); await new Promise((resolve) => setTimeout(resolve, 500)); try { await action(); } finally { this.command('save-on'); } }
  async stop() {
    const child = this.process;
    if (!child) { if (this.state !== 'stopped') this.setState('stopped'); return; }
    this.setState('stopping'); this.command('save-all flush'); this.command('stop');
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 90_000);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    if (!exited) {
      // Un mod puede quedarse colgado descargando chunks al cerrar. No dejamos el botón
      // "Detener" bloqueado para siempre: forzamos el cierre y esperamos a que libere archivos.
      this.onLog('[Servidor] No se cerró en 90 segundos; forzando el cierre.');
      try { child.kill(); } catch { /* ya terminó */ }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    // Si el evento exit no llegó, igual liberamos el estado para no quedar en "stopping".
    if (this.process === child) { this.process = null; this.setState('stopped'); }
  }
  private setState(state: typeof this.state) { this.state = state; this.onState(state); }
}
