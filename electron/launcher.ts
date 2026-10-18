import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GdLauncherInfo } from './types';

// GDLauncher (tanto el legacy como Carbon) no expone un CLI ni deep-links para abrir una instancia
// dentro de un servidor: lo único que ofrece son los "Custom Commands" (Ajustes -> Custom Commands),
// donde el "Wrapper Command" envuelve el arranque de Java y recibe `<java> <todos los argumentos>`
// igual que el wrapper de Prism/MultiMC. Lantern genera ese script una sola vez y hace que lea la
// dirección del servidor activo desde un archivo, así el juego entra directo sin reconfigurar nada.

export function wrapperDir(userDataDir: string): string {
  return path.join(userDataDir, 'gdlauncher');
}
export function wrapperScriptPath(userDataDir: string): string {
  return path.join(wrapperDir(userDataDir), 'lantern-join.cmd');
}
export function wrapperTargetPath(userDataDir: string): string {
  return path.join(wrapperDir(userDataDir), 'join-target.txt');
}

// Valor exacto que el usuario pega en GDLauncher -> Ajustes -> Custom Commands -> Wrapper Command.
// GDLauncher duplica las barras invertidas antes de separar el comando con shlex, así que hay que
// indicar la ruta normal de Windows (una sola barra). Si tiene espacios, se entrecomilla.
export function wrapperCommandLine(userDataDir: string): string {
  const script = wrapperScriptPath(userDataDir);
  return /\s/.test(script) ? `"${script}"` : script;
}

// El script recibe la ruta de Java como primer argumento y el resto de la línea de arranque. Si hay
// una dirección activa agrega --quickPlayMultiplayer (Minecraft 1.20+/26.x) para entrar directo; si
// no, ejecuta el juego normal (un jugador u otro servidor). El comando corre en primer plano para
// que GDLauncher siga viendo la sesión (hooks post-exit y tiempo de juego). Se usan etiquetas en vez
// de bloques con paréntesis para tolerar rutas que contengan «(x86)» u otros paréntesis.
export function wrapperScriptContent(): string {
  return [
    '@echo off',
    'setlocal',
    'set "LANTERN_TARGET=%~dp0join-target.txt"',
    'set "LANTERN_ADDR="',
    'if exist "%LANTERN_TARGET%" set /p LANTERN_ADDR=<"%LANTERN_TARGET%"',
    'if not defined LANTERN_ADDR goto lantern_plain',
    '%* --quickPlayMultiplayer %LANTERN_ADDR%',
    'goto lantern_done',
    ':lantern_plain',
    '%*',
    ':lantern_done',
    'endlocal',
    ''
  ].join('\r\n');
}

export async function ensureWrapperScript(userDataDir: string): Promise<string> {
  const script = wrapperScriptPath(userDataDir);
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(script, wrapperScriptContent(), 'utf8');
  return script;
}

// Dirección `ip:puerto` del servidor activo, o null para no forzar ninguna conexión.
export async function setWrapperTarget(userDataDir: string, address: string | null): Promise<void> {
  const target = wrapperTargetPath(userDataDir);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, (address ?? '').trim(), 'utf8');
}

export function gdLauncherInfo(userDataDir: string, target: string | null): GdLauncherInfo {
  return { script: wrapperScriptPath(userDataDir), command: wrapperCommandLine(userDataDir), target };
}
