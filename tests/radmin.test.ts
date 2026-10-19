import { describe, expect, it } from 'vitest';
import { buildRadminPowerScript, parseRadminPower } from '../electron/radmin';

describe('electron/radmin parseRadminPower', () => {
  it('reconoce los tokens que imprime el script', () => {
    expect(parseRadminPower('ON')).toBe('on');
    expect(parseRadminPower('OFF')).toBe('off');
    expect(parseRadminPower('MISSING')).toBe('missing');
    expect(parseRadminPower('NOWINDOW')).toBe('nowindow');
    expect(parseRadminPower('TIMEOUT')).toBe('timeout');
    expect(parseRadminPower('ERROR')).toBe('error');
  });

  it('ignora ruido y toma el último token válido', () => {
    const output = 'WARNING: algo\r\nDesconectado\r\nON\r\n';
    expect(parseRadminPower(output)).toBe('on');
  });

  it('devuelve error si no hay ningún token reconocible', () => {
    expect(parseRadminPower('')).toBe('error');
    expect(parseRadminPower('algo inesperado')).toBe('error');
    // Las palabras que contienen un token pero no son el token exacto no deben confundir al parser.
    expect(parseRadminPower('CONNECTED')).toBe('error');
  });
});

describe('electron/radmin buildRadminPowerScript', () => {
  it('usa el automationId del botón de encendido de Radmin', () => {
    const script = buildRadminPowerScript({ mode: 'ensure', windowWaitMs: 5_000, connectWaitMs: 7_000 });
    expect(script).toContain('MainWindow.centralWidget.mainContentWidget.userInfoWidget.BPower');
    expect(script).toContain('InvokePattern');
    expect(script).toContain('5000');
    expect(script).toContain('7000');
  });

  it('en modo status no acciona el botón', () => {
    const script = buildRadminPowerScript({ mode: 'status', windowWaitMs: 1_000, connectWaitMs: 2_000 });
    expect(script).toContain("'status'");
    expect(script).toContain('Write-Output \'OFF\'');
  });

  it('sólo usa caracteres ASCII (Windows PowerShell lo lee sin BOM)', () => {
    const script = buildRadminPowerScript({ mode: 'ensure', windowWaitMs: 1, connectWaitMs: 1 });
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(script)).toBe(true);
  });
});
