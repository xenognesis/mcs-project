import { networkInterfaces } from 'node:os';
import net from 'node:net';

export function findRadminIp() {
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!/radmin/i.test(name)) continue;
    const hit = entries?.find((item) => item.family === 'IPv4' && !item.internal);
    if (hit) return hit.address;
  }
  return null;
}
export function canReach(ip: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: 2500 }, () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
