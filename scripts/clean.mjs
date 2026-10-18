// Borra las salidas compiladas antes de recompilar. Hace falta porque `tsc` no elimina los archivos
// cuyo fuente ya no existe (p. ej. `dist-electron/launcher.js` quedó huérfano al quitar el wrapper de
// GDLauncher) y esos restos se empaquetarían dentro del `app.asar`.
import { rmSync } from 'node:fs';

for (const dir of ['dist-electron', 'dist']) {
  rmSync(dir, { recursive: true, force: true });
}
