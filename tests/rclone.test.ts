import { describe, expect, it, vi } from 'vitest';
import type { execFile } from 'node:child_process';
import { cleanupDriveTrash, rcloneCleanupTarget } from '../electron/rclone';

type Run = typeof execFile;

function fakeRun(result: { error?: Error; stderr?: string }) {
  const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
  const run = ((
    file: string,
    args: readonly string[],
    options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    calls.push({ file, args, options });
    callback(result.error ?? null, '', result.stderr ?? '');
  }) as unknown as Run;
  return { run, calls };
}

describe('rclone cleanup', () => {
  it('normaliza el remoto a gdrive:', () => {
    expect(rcloneCleanupTarget('gdrive')).toBe('gdrive:');
    expect(rcloneCleanupTarget(' gdrive: ')).toBe('gdrive:');
    expect(rcloneCleanupTarget('gdrive:carpeta')).toBe('gdrive:');
  });

  it('no ejecuta nada si no hay remoto configurado', () => {
    const { run, calls } = fakeRun({});
    const log = vi.fn();
    cleanupDriveTrash({}, log, run);
    expect(calls).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('ejecuta rclone cleanup en el remoto configurado', () => {
    const { run, calls } = fakeRun({});
    const log = vi.fn();
    cleanupDriveTrash({ rclonePath: 'C:\\rclone\\rclone.exe', rcloneRemote: 'gdrive' }, log, run);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('C:\\rclone\\rclone.exe');
    expect(calls[0].args).toEqual(['cleanup', 'gdrive:']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Papelera de Google Drive vaciada'));
  });

  it('registra el error sin lanzar excepción', () => {
    const { run } = fakeRun({ error: new Error('boom'), stderr: 'no such remote' });
    const log = vi.fn();
    expect(() => cleanupDriveTrash({ rcloneRemote: 'gdrive' }, log, run)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No se pudo vaciar la papelera: no such remote'));
  });
});
