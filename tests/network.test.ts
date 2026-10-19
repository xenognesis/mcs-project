import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { radminExeCandidates } from '../electron/network';

describe('electron/network radminExeCandidates', () => {
  it('arma las rutas típicas desde las variables de entorno de Windows', () => {
    expect(radminExeCandidates({ 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' })).toEqual([
      path.join('C:\\Program Files (x86)', 'Radmin VPN', 'RvRvpnGui.exe'),
      path.join('C:\\Program Files', 'Radmin VPN', 'RvRvpnGui.exe')
    ]);
  });

  it('tolera variables faltantes', () => {
    expect(radminExeCandidates({})).toEqual([]);
    expect(radminExeCandidates({ 'ProgramFiles(x86)': 'C:\\PF' })).toEqual([path.join('C:\\PF', 'Radmin VPN', 'RvRvpnGui.exe')]);
  });
});
