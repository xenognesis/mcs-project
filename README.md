# Lantern Host

Aplicación Electron para que tres amigos operen un servidor Minecraft Java moddeado desde cualquiera de sus PCs Windows, manteniendo el mundo en Google Drive y evitando anfitriones simultáneos con un lease en GitHub.

## Desarrollo

Requiere Node 22+ y pnpm. Ejecutar `pnpm install` y luego `pnpm dev`. Para generar el instalador Windows: `pnpm package`. Para publicar una versión nueva: `pnpm release` (requiere `GH_TOKEN`, ver *Actualizaciones*).

## Preparación compartida

1. Instalar [Google Drive para escritorio](https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe) y elegir la misma carpeta compartida en las tres PCs. Dentro debe existir `world/`; la app creará `backups/`, `conflicts/` y `world-state.json`.
2. Crear dos repositorios privados: `minecraft-pack` y `minecraft-coordination`. En el segundo, crear inicialmente `server-status.json` con un lease vacío o permitir que el primer cliente lo cree.
3. Publicar en el repositorio de pack un `manifest.json`. Cada archivo declara `path`, `sha256`, `url` y opcionalmente `scope` (`server` o `client`); la aplicación descarga sólo los que difieren. Los archivos `client` se instalan en la instancia MultiMC configurada. El manifiesto debe declarar `loader: "fabric"`, `minecraftVersion`, `serverJar`, `clientArchive` y `files`.
4. Crear un bot Discord, invitarlo al servidor privado que comparten los jugadores y configurar los Discord IDs. Al invitarlo, incluí los scopes `bot` **y** `applications.commands` (permisos *Send Messages* y *Embed Links*) para que funcionen los comandos slash. Todos deben permitir DMs del servidor.
5. Configurar MultiMC, iniciar sesión con una cuenta Microsoft propia y crear/importar una instancia con el ID indicado en Lantern.

Los tokens de GitHub y Discord se guardan usando el almacenamiento seguro de Electron (DPAPI en Windows). No se incluyen en el repositorio.

## Lanzadores y entrada directa

Lantern puede entrar directo al servidor al abrir el juego, según el launcher:

- **MultiMC / Prism**: indicá `MultiMC.exe` y el ID de instancia. Lantern ejecuta `MultiMC.exe --launch <instancia> --server <ip:puerto>`.
- **GDLauncher**: no expone línea de comandos ni deep-links para abrir una instancia en un servidor, así que se usa su **Wrapper Command** (Ajustes → Custom Commands). Lantern deja un script en `%APPDATA%\lantern-minecraft-host\gdlauncher\lantern-join.cmd` y mantiene la dirección del servidor activo en `join-target.txt`. Pegá en **Wrapper Command** la ruta que muestra la pantalla *Configuración* (una sola vez); desde entonces, con un servidor activo, al abrir el juego entrará solo vía `--quickPlayMultiplayer`. Si no hay servidor activo, el juego abre normal. El wrapper se puede acotar a una sola instancia usando el override por instancia en lugar del ajuste global.
- **Otro launcher**: activá *Iniciar Minecraft manualmente*; Lantern copia la dirección al portapapeles.

## Actualizaciones

La app se actualiza sola desde los **GitHub Releases** de su propio repositorio (`xenognesis/mcs-project`). Al arrancar comprueba en segundo plano; si hay una versión más nueva la descarga, y cuando el **servidor está detenido** se reinicia sola para instalarla y vuelve a abrir. Si hay un servidor en línea, la instalación queda pendiente y se aplica al cerrar la app, para no cortar la partida. También se puede forzar desde el botón de la versión en la barra superior.

No hace falta ningún token para actualizar: el repositorio `xenognesis/mcs-project` es **público**, así que la app lee las Releases sin credenciales. Los tokens de GitHub de cada PC se usan únicamente para los repositorios **privados** del pack y de la coordinación. (Si el repo volviera a ser privado, la verificación automática fallaría en silencio: habría que volver al modo autenticado.)

Para publicar una versión nueva:

1. Subir `version` en `package.json` (semver, sin la `v`).
2. Definir el token con permiso de escritura sobre Releases y ejecutar:

   ```powershell
   $env:GH_TOKEN = "ghp_..."   # token con scope repo (o Contents: write)
   pnpm release
   ```

   `pnpm release` compila, genera el instalador y sube a GitHub el `.exe`, su `.blockmap` y `latest.yml`. El release se publica (no borrador), que es lo que el actualizador consulta vía `/releases/latest`.

   Si falla con **422 "Published releases must have a valid tag"**, es una carrera conocida de electron-builder: sube los tres archivos en paralelo y todos intentan crear la release a la vez. Volvé a ejecutar el mismo comando enseguida (dentro de las 2 horas): reutiliza la release ya creada y completa lo que falte. Para no depender de ese límite de 2 horas, exportá `EP_GH_IGNORE_TIME=true` antes de publicar.

Las instalaciones existentes se actualizan solas a partir de esa publicación. Como el repositorio es público, esa verificación **no usa ningún token**: sólo hace falta `GH_TOKEN` para *publicar*.

## Comandos de Discord

Mientras alguien aloja el servidor, el bot expone estos comandos slash (respuestas **efímeras**: sólo las ve quien los ejecuta):

- `/coords` -> coordenadas guardadas en el mod `tracker-mod` (públicas + las privadas de quien consulta).
- `/todos` -> lista de tareas del tracker (públicas + las privadas de quien consulta).
- `/tracker` -> ambas listas.

Las entradas marcadas como privadas sólo se muestran a su autor (`createdBy`), por lo que las privadas no se filtran. Los comandos leen `config/tracker-mod/data.json` dentro de la carpeta compartida de Drive; se puede indicar otra ruta en el asistente. El ID del servidor (guild) se detecta desde el canal de Discord configurado, o se puede fijar manualmente. Además, el administrador autorizado puede ejecutar comandos de consola por mensaje con `!cmd <comando>`.

## Límites de seguridad

Los mundos no se fusionan. Si el hash del directorio `world` y el manifiesto publicado no coinciden, el arranque se bloquea. Al restaurar, la copia anterior se conserva bajo `conflicts/`. El cálculo del hash ignora archivos volátiles que el servidor reescribe o que no representan avance (por ejemplo `session.lock`, `random_sequences.dat`, `*.dat_old`, `*.tmp` y la carpeta `crash-reports`), para evitar bloqueos por desincronización de Google Drive.