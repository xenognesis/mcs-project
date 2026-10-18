import { describe, expect, it } from 'vitest';
import { formatBytes, progressPercent, shouldInstallNow, updateGateFor } from '../electron/update-policy';

describe('electron/update-policy', () => {
  it('formatea bytes con coma decimal y unidad MB', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(-5)).toBe('0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 MB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1,50 MB');
    expect(formatBytes(1024 * 1024 * 42.4)).toBe('42,4 MB');
    expect(formatBytes(1024 * 1024 * 108)).toBe('108 MB');
  });

  it('calcula el porcentaje entero a partir del progreso', () => {
    expect(progressPercent({ percent: 45.4 })).toBe(45);
    expect(progressPercent({ percent: -3 })).toBe(0);
    expect(progressPercent({ percent: 140 })).toBe(100);
    expect(progressPercent({ transferred: 50, total: 200 })).toBe(25);
    expect(progressPercent({ transferred: 10, total: 0 })).toBe(0);
    expect(progressPercent({})).toBe(0);
  });

  it('instala sólo cuando terminó la descarga y el servidor está detenido', () => {
    expect(shouldInstallNow('downloaded', false)).toBe(true);
    expect(shouldInstallNow('downloaded', true)).toBe(false);
    expect(shouldInstallNow('downloading', false)).toBe(false);
    expect(shouldInstallNow('available', false)).toBe(false);
    expect(shouldInstallNow('idle', false)).toBe(false);
  });

  it('bloquea iniciar/unirse sólo cuando hay una versión nueva', () => {
    expect(updateGateFor('idle').proceed).toBe(true);
    expect(updateGateFor('current').proceed).toBe(true);
    expect(updateGateFor('error').proceed).toBe(true);
    expect(updateGateFor('available', '1.6.2').proceed).toBe(false);
    expect(updateGateFor('downloading', '1.6.2').proceed).toBe(false);
    expect(updateGateFor('downloaded').proceed).toBe(false);
  });

  it('menciona la versión nueva en el mensaje cuando se conoce', () => {
    const available = updateGateFor('available', '1.6.2');
    const downloaded = updateGateFor('downloaded', '1.6.2');
    expect(available.proceed).toBe(false);
    expect(downloaded.proceed).toBe(false);
    if (!available.proceed) expect(available.message).toContain('v1.6.2');
    if (!downloaded.proceed) expect(downloaded.message.length).toBeGreaterThan(0);
  });
});
