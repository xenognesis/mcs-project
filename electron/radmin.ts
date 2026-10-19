import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type RadminPower = 'on' | 'off' | 'missing' | 'nowindow' | 'timeout' | 'error';

// Radmin VPN no expone API ni argumento para encenderse (sólo acepta `/show` y `/minimized`):
// el encendido es el botón "power" de su ventana. Este script de UI Automation busca ese botón
// por su automationId (estable en el GUI Qt) y lo acciona. Se ejecuta con Windows PowerShell.
export function buildRadminPowerScript(options: { mode: 'status' | 'ensure'; windowWaitMs: number; connectWaitMs: number }): string {
  const { mode, windowWaitMs, connectWaitMs } = options;
  return `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae = [System.Windows.Automation.AutomationElement]
$ts = [System.Windows.Automation.TreeScope]
$root = $ae::RootElement
$idPower = 'MainWindow.centralWidget.mainContentWidget.userInfoWidget.BPower'
function Test-PowerOn($element) {
  try {
    return ([System.Windows.Automation.TogglePattern]$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)).Current.ToggleState -eq 'On'
  } catch { return $false }
}
$deadline = (Get-Date).AddMilliseconds(${windowWaitMs})
$btn = $null
while (-not $btn -and (Get-Date) -lt $deadline) {
  if (-not (Get-Process RvRvpnGui -ErrorAction SilentlyContinue)) { Write-Output 'MISSING'; exit 0 }
  $cond = New-Object System.Windows.Automation.PropertyCondition($ae::AutomationIdProperty, $idPower)
  $btn = $root.FindFirst($ts::Descendants, $cond)
  if (-not $btn) { Start-Sleep -Milliseconds 500 }
}
if (-not $btn) { Write-Output 'NOWINDOW'; exit 0 }
if (Test-PowerOn $btn) { Write-Output 'ON'; exit 0 }
if ('${mode}' -eq 'status') { Write-Output 'OFF'; exit 0 }
try {
  ([System.Windows.Automation.InvokePattern]$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
} catch { Write-Output 'ERROR'; exit 0 }
$deadline2 = (Get-Date).AddMilliseconds(${connectWaitMs})
while ((Get-Date) -lt $deadline2) {
  Start-Sleep -Milliseconds 500
  if (Test-PowerOn $btn) { Write-Output 'ON'; exit 0 }
}
Write-Output 'TIMEOUT'
`;
}

const TOKENS: Record<string, RadminPower> = { ON: 'on', OFF: 'off', MISSING: 'missing', NOWINDOW: 'nowindow', TIMEOUT: 'timeout', ERROR: 'error' };

// PowerShell puede ensuciar la salida (mensajes de arranque, CLIXML…), así que tomamos la última
// línea que sea exactamente uno de los tokens que el script imprime.
export function parseRadminPower(output: string): RadminPower {
  const lines = output.split(/\r?\n/).map((line) => line.trim().toUpperCase());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const hit = TOKENS[lines[index]];
    if (hit) return hit;
  }
  return 'error';
}

export function runRadminPower(mode: 'status' | 'ensure', options: { windowWaitMs?: number; connectWaitMs?: number } = {}): Promise<RadminPower> {
  const windowWaitMs = options.windowWaitMs ?? 10_000;
  const connectWaitMs = options.connectWaitMs ?? 15_000;
  const script = buildRadminPowerScript({ mode, windowWaitMs, connectWaitMs });
  return new Promise((resolve) => {
    mkdtemp(path.join(tmpdir(), 'lantern-radmin-'))
      .then(async (dir) => {
        const file = path.join(dir, 'radmin-power.ps1');
        await writeFile(file, script, 'utf8');
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
          { windowsHide: true, timeout: windowWaitMs + connectWaitMs + 15_000 },
          (error, stdout) => {
            void rm(dir, { recursive: true, force: true }).catch(() => undefined);
            resolve(error && !stdout ? 'error' : parseRadminPower(String(stdout ?? '')));
          },
        );
      })
      .catch(() => resolve('error'));
  });
}
