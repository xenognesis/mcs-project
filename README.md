# Lantern Host

Aplicación Electron para que tres amigos operen un servidor Minecraft Java moddeado desde cualquiera de sus PCs Windows, manteniendo el mundo en Google Drive y evitando anfitriones simultáneos con un lease en GitHub.

## Desarrollo

Requiere Node 22+ y pnpm. Ejecutar `pnpm install` y luego `pnpm dev`. Para generar el instalador Windows: `pnpm package`.

## Preparación compartida

1. Instalar [Google Drive para escritorio](https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe) y elegir la misma carpeta compartida en las tres PCs. Dentro debe existir `world/`; la app creará `backups/`, `conflicts/` y `world-state.json`.
2. Crear dos repositorios privados: `minecraft-pack` y `minecraft-coordination`. En el segundo, crear inicialmente `server-status.json` con un lease vacío o permitir que el primer cliente lo cree.
3. Publicar en el repositorio de pack un `manifest.json`. Cada archivo declara `path`, `sha256`, `url` y opcionalmente `scope` (`server` o `client`); la aplicación descarga sólo los que difieren. Los archivos `client` se instalan en la instancia MultiMC configurada. El manifiesto debe declarar `loader: "fabric"`, `minecraftVersion`, `serverJar`, `clientArchive` y `files`.
4. Crear un bot Discord, invitarlo al servidor privado que comparten los jugadores y configurar los Discord IDs. Al invitarlo, incluí los scopes `bot` **y** `applications.commands` (permisos *Send Messages* y *Embed Links*) para que funcionen los comandos slash. Todos deben permitir DMs del servidor.
5. Configurar MultiMC, iniciar sesión con una cuenta Microsoft propia y crear/importar una instancia con el ID indicado en Lantern.

Los tokens de GitHub y Discord se guardan usando el almacenamiento seguro de Electron (DPAPI en Windows). No se incluyen en el repositorio.

## Comandos de Discord

Mientras alguien aloja el servidor, el bot expone estos comandos slash (respuestas **efímeras**: sólo las ve quien los ejecuta):

- `/coords` -> coordenadas guardadas en el mod `tracker-mod` (públicas + las privadas de quien consulta).
- `/todos` -> lista de tareas del tracker (públicas + las privadas de quien consulta).
- `/tracker` -> ambas listas.

Las entradas marcadas como privadas sólo se muestran a su autor (`createdBy`), por lo que las privadas no se filtran. Los comandos leen `config/tracker-mod/data.json` dentro de la carpeta compartida de Drive; se puede indicar otra ruta en el asistente. El ID del servidor (guild) se detecta desde el canal de Discord configurado, o se puede fijar manualmente. Además, el administrador autorizado puede ejecutar comandos de consola por mensaje con `!cmd <comando>`.

## Límites de seguridad

Los mundos no se fusionan. Si el hash del directorio `world` y el manifiesto publicado no coinciden, el arranque se bloquea. Al restaurar, la copia anterior se conserva bajo `conflicts/`. El cálculo del hash ignora archivos volátiles que el servidor reescribe o que no representan avance (por ejemplo `session.lock`, `random_sequences.dat`, `*.dat_old`, `*.tmp` y la carpeta `crash-reports`), para evitar bloqueos por desincronización de Google Drive.