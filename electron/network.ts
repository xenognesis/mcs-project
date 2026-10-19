import { networkInterfaces } from 'node:os';
import net from 'node:net';
import path from 'node:path';

export function findRadminIp() {
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!/radmin/i.test(name)) continue;
    const hit = entries?.find((item) => item.family === 'IPv4' && !item.internal);
    if (hit) return hit.address;
  }
  return null;
}
/**
 * Rutas típicas del ejecutable de Radmin VPN (el GUI que enciende el adaptador y conecta la red).
 * Se resuelven desde las variables de entorno de Windows para no depender del idioma del sistema.
 */
export function radminExeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [env['ProgramFiles(x86)'], env['ProgramFiles']].filter((value): value is string => Boolean(value));
  return roots.map((root) => path.join(root, 'Radmin VPN', 'RvRvpnGui.exe'));
}
export function canReach(ip: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: 2500 }, () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
