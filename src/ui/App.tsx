import { FormEvent, useCallback, useEffect, useState } from 'react';

const emptyConfig = (): AppConfig => ({ playerName: '', isAdmin: false, githubToken: '', discordBotToken: '', discordChannelId: '', discordGuildId: '', trackerDataPath: '', adminPassword: '', adminDiscordId: '', manualLauncher: false, clientInstancePath: '', packRepo: { owner: '', repo: 'minecraft-pack', branch: 'main' }, coordinationRepo: { owner: '', repo: 'minecraft-coordination', branch: 'main' }, driveRoot: '', multiMcPath: '', multiMcInstance: 'shared-server', javaPath: 'java', serverJar: 'server.jar', serverMemoryMb: 4096, port: 25565, players: [], backupIntervalMinutes: 60, backupRetention: 20, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

function toastError(error: unknown) { return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null); const [config, setConfig] = useState<AppConfig>(emptyConfig); const [screen, setScreen] = useState<'home' | 'setup' | 'backups'>('home');
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [slowBusy, setSlowBusy] = useState(false); const [backups, setBackups] = useState<string[]>([]);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const refresh = useCallback(async () => { const next = await window.lantern.status(); setStatus(next); setUpdate(next.update); }, []);
  useEffect(() => { void Promise.all([refresh(), window.lantern.config.get().then(setConfig)]); window.lantern.onLog(() => void refresh()); window.lantern.onServerState(() => void refresh()); window.lantern.onUpdateState(setUpdate); const id = window.setInterval(() => void refresh(), 30_000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { if (!busy) { setSlowBusy(false); return; } const id = window.setTimeout(() => setSlowBusy(true), 450); return () => window.clearTimeout(id); }, [busy]);
  // El aviso de "estás al día" es transitorio; las demás fases quedan hasta que cambien.
  useEffect(() => { if (update?.phase !== 'current') return; const id = window.setTimeout(() => setUpdate({ phase: 'idle' }), 5000); return () => window.clearTimeout(id); }, [update]);
  const action = async (work: () => Promise<unknown>, success: string) => { setBusy(true); try { await work(); setNotice(success); await refresh(); } catch (error) { setNotice(toastError(error)); } finally { setBusy(false); } };
  const checkUpdate = () => { void window.lantern.checkUpdate().catch(() => undefined); };
  const installUpdate = () => { void window.lantern.installUpdate().catch((error) => setNotice(toastError(error))); };
  const activeLease = status?.lease; const isHost = status?.server !== 'stopped';
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="lantern">◈</span><div><strong>Lantern Host</strong><small>Servidor compartido · Fabric</small></div></div><nav><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>Centro de control</button><button className={screen === 'backups' ? 'active' : ''} onClick={() => { setScreen('backups'); void window.lantern.backups().then(setBackups); }}>Backups</button><button className={screen === 'setup' ? 'active' : ''} onClick={() => setScreen('setup')}>Configuración</button></nav><button className="quiet version" title="Buscar actualizaciones" onClick={checkUpdate} disabled={busy}>v{status?.version ?? '—'}</button><span className={`pill ${status?.server ?? 'stopped'}`}>{status?.server === 'running' ? 'Servidor en línea' : status?.server === 'starting' ? 'Iniciando' : 'En espera'}</span></header>
    <UpdateBar update={update} busy={busy} onCheck={checkUpdate} onInstall={installUpdate} />
    {notice ? <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div> : null}
    {screen === 'home' ? <Dashboard status={status} config={config} busy={busy} isHost={isHost} activeLease={activeLease} onAction={action} onRefresh={refresh} /> : null}
    {screen === 'setup' ? <Setup config={config} setConfig={setConfig} busy={busy} status={status} onSave={(next) => action(async () => { setConfig(next); await window.lantern.config.save(next); }, 'Configuración guardada y secretos protegidos por Windows.')} /> : null}
    {screen === 'backups' ? <BackupView backups={backups} busy={busy} onRestore={(name) => action(async () => { if (!confirm(`Se archivará el mundo actual y se restaurará ${name}.`)) return; await window.lantern.restore(name); }, 'Backup restaurado; el mundo previo quedó archivado en conflicts.')} /> : null}
    {slowBusy ? <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-card"><span className="spinner" aria-hidden="true" /><p>La instrucción actual se está ejecutando, por favor esperar.</p></div></div> : null}
  </main>;
}

function UpdateBar({ update, busy, onCheck, onInstall }: { update: UpdateState | null; busy: boolean; onCheck: () => void; onInstall: () => void }) {
  if (!update || update.phase === 'idle') return null;
  if (update.phase === 'checking') return <div className="update-bar">Buscando actualizaciones…</div>;
  if (update.phase === 'current') return <div className="update-bar ok">Ya tenés la última versión instalada (v{update.version}).</div>;
  if (update.phase === 'available') return <div className="update-bar">Nueva versión {update.version} disponible. Descargando en segundo plano…</div>;
  if (update.phase === 'downloading') return <div className="update-bar"><span>Descargando v{update.version} · {update.percent ?? 0}%{update.detail ? ` (${update.detail})` : ''}</span><span className="update-progress"><i style={{ width: `${update.percent ?? 0}%` }} /></span></div>;
  if (update.phase === 'downloaded') return <div className="update-bar ready"><span>La versión {update.version} está lista para instalarse.</span><button className="primary" disabled={busy} onClick={onInstall}>Reiniciar y actualizar</button></div>;
  return <div className="update-bar error"><span>No se pudo comprobar la actualización: {update.message}</span><button className="quiet" onClick={onCheck}>Reintentar</button></div>;
}

function Dashboard({ status, config, busy, isHost, activeLease, onAction, onRefresh }: { status: AppStatus | null; config: AppConfig; busy: boolean; isHost: boolean; activeLease: Lease | null | undefined; onAction: (task: () => Promise<unknown>, message: string) => Promise<void>; onRefresh: () => Promise<void> }) {
  const canStart = status?.requirements.every((item) => item.ok) && (!activeLease || isHost);
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [publishNeedsKey, setPublishNeedsKey] = useState(false);
  const [publishPassword, setPublishPassword] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const submitPublish = async (event: FormEvent) => {
    event.preventDefault();
    if (!publishPassword.trim()) return;
    setPublishing(true); setPublishError('');
    try {
      await window.lantern.unlock(publishPassword.trim());
      setPublishPassword(''); setPublishNeedsKey(false);
      await onAction(() => window.lantern.publishWorld(), 'Mundo actual publicado como nueva base.');
    } catch (error) {
      setPublishError(toastError(error));
    } finally { setPublishing(false); }
  };

  return <section className="dashboard">
    <div className="hero"><div><p className="eyebrow">MUNDO COMPARTIDO / RADMIN VPN</p><h1>Todo listo para<br/><em>encender la fogata.</em></h1><p className="lede">Un anfitrión, una copia fiable del mundo y una ruta clara para que los demás entren.</p></div><div className="world-card"><span>Estado del mundo</span><strong>{status?.localWorldHash && status.localWorldHash === status.publishedWorldHash ? 'Sincronizado' : 'Requiere atención'}</strong><small>{status?.localWorldHash ? `Hash ${status.localWorldHash.slice(0, 12)}` : 'Aún no hay mundo configurado'}</small>{status?.localWorldHash && status.localWorldHash !== status.publishedWorldHash && status.server === 'stopped' ? <div className="world-publish-area"><button className="quiet world-publish" disabled={busy || publishing} title="Declarar el mundo actual como la nueva base publicada" onClick={() => { if (!confirm('Se declarará el mundo actual como la nueva base publicada. Hacelo sólo si reemplazaste el mundo a propósito; el resto de los jugadores deberá sincronizar esta copia. ¿Continuar?')) return; if (status?.consoleUnlocked) { void onAction(() => window.lantern.publishWorld(), 'Mundo actual publicado como nueva base.'); } else { setPublishError(''); setPublishNeedsKey(true); } }}>Publicar mundo actual</button>{publishNeedsKey ? <form className="world-unlock" onSubmit={submitPublish}><input type="password" placeholder="Clave maestra para publicar..." value={publishPassword} onChange={(e) => { setPublishPassword(e.target.value); setPublishError(''); }} disabled={publishing} autoComplete="current-password"/><button type="submit" className="quiet" disabled={publishing || !publishPassword.trim()}>{publishing ? 'Verificando…' : 'Desbloquear y publicar'}</button></form> : null}{publishError ? <span className="field-error">{publishError}</span> : null}</div> : null}</div></div>
    <div className="actions">
      {isHost ? <button className="primary danger" disabled={busy} onClick={() => void onAction(() => window.lantern.stop(), 'Servidor detenido, mundo guardado y backup final creado.')}>Detener y guardar</button> : activeLease ? <><button className="primary" disabled={busy} onClick={() => void onAction(() => window.lantern.join(), config.manualLauncher ? 'IP copiada. Si configuraste el wrapper de GDLauncher, el juego entrará solo.' : `Abriendo MultiMC para unirse a ${activeLease.hostName}.`)}>Unirse al servidor</button><span>Activo por <b>{activeLease.hostName}</b> · {activeLease.ip}:{activeLease.port}</span></> : <button className="primary" disabled={busy || !canStart} onClick={() => void onAction(() => window.lantern.start(), config.manualLauncher ? 'Servidor iniciado. IP copiada. Con el wrapper de GDLauncher, el juego entrará solo.' : 'Servidor iniciado. MultiMC se abrirá automáticamente.')}>Iniciar servidor y jugar</button>}
      <button className="quiet" disabled={busy} onClick={() => void onAction(() => window.lantern.sync(), 'Pack verificado y actualizado.')}>Sincronizar pack</button>
      <button className="quiet" onClick={() => void onAction(async () => { const ip = await window.lantern.copyIp(); if (!ip) throw new Error('No se detectó la IP de Radmin VPN.'); }, 'IP de Radmin copiada.')}>Copiar IP Radmin</button>
    </div>
    <div className="grid"><section className="panel requirements"><div className="panel-title"><h2>Antes de jugar</h2><span>{status?.requirements.filter((item) => item.ok).length ?? 0}/{status?.requirements.length ?? 5}</span></div>{status?.requirements.map((item) => <div className="requirement" key={item.name}><i className={item.ok ? 'ok' : 'missing'}>{item.ok ? '✓' : '!'}</i><div><b>{item.name}</b><small>{item.detail}</small></div></div>)}</section><section className="panel log"><div className="panel-title"><h2>Bitácora</h2><span>en vivo</span></div><pre>{status?.logs.length ? status.logs.join('\n') : 'Esperando actividad…'}</pre></section></div>
    
    {!status?.consoleUnlocked ? (
      <div className="console-box locked">
        <div className="console-header">
          <label>🔒 Consola del servidor</label>
          <span className="console-badge locked">Bloqueada</span>
        </div>
        <p className="console-help">Requiere la clave maestra del administrador. Podés desbloquear con el servidor apagado; los comandos se habilitan cuando el servidor está en línea.</p>
        <form className="console-unlock-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!passwordInput.trim()) return;
          setUnlocking(true);
          setUnlockError('');
          try {
            await window.lantern.unlock(passwordInput.trim());
            setPasswordInput('');
            await onRefresh();
          } catch (err) {
            setUnlockError(err instanceof Error ? err.message : 'Clave incorrecta');
          } finally {
            setUnlocking(false);
          }
        }}>
          <input
            type="password"
            placeholder="Ingresá la clave maestra para desbloquear..."
            value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setUnlockError(''); }}
            disabled={unlocking}
            autoComplete="current-password"
          />
          <button type="submit" className="quiet" disabled={unlocking || !passwordInput.trim()}>
            {unlocking ? 'Verificando…' : 'Desbloquear'}
          </button>
        </form>
        {unlockError ? <span className="field-error">{unlockError}</span> : null}
      </div>
    ) : (
      <div className="console-box unlocked">
        <div className="console-header">
          <label>Consola del servidor</label>
          <div className="console-actions">
            <span className="console-badge unlocked">🔓 Administrador verificado</span>
            <button type="button" className="btn-link" onClick={async () => { await window.lantern.lock(); await onRefresh(); }}>Bloquear</button>
          </div>
        </div>
        <form className="console-form" onSubmit={(e) => {
          e.preventDefault();
          const target = e.target as HTMLFormElement;
          const input = target.elements.namedItem('cmd') as HTMLInputElement;
          if (input.value.trim() && status?.server === 'running') {
            void window.lantern.command(input.value.trim()).catch((err) => alert(toastError(err)));
            input.value = '';
          }
        }}>
          <input name="cmd" disabled={status?.server !== 'running'} placeholder={status?.server === 'running' ? 'Escribí un comando (ej: op tu_nombre) y presioná Enter...' : 'Disponible cuando el servidor esté en línea'} autoComplete="off" />
        </form>
      </div>
    )}
  </section>;
}

const playersToText = (players: Player[]) => players.map((player) => `${player.name}: ${player.discordId}`).join('\n');
const parsePlayers = (value: string): Player[] => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
  const separator = line.indexOf(':');
  if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error(`Formato inválido: “${line}”. Usá Nombre: Discord ID.`);
  return { name: line.slice(0, separator).trim(), discordId: line.slice(separator + 1).trim() };
});

function Setup({ config, setConfig, busy, status, onSave }: { config: AppConfig; setConfig: (value: AppConfig) => void; busy: boolean; status: AppStatus | null; onSave: (next: AppConfig) => void }) {
  const update = (key: keyof AppConfig, value: string | number) => setConfig({ ...config, [key]: value });
  const [manifest, setManifest] = useState('');
  const [playersText, setPlayersText] = useState(() => playersToText(config.players));
  const [playersError, setPlayersError] = useState('');
  useEffect(() => setPlayersText(playersToText(config.players)), [config.players]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try { setPlayersError(''); onSave({ ...config, players: parsePlayers(playersText) }); }
    catch (error) { setPlayersError(toastError(error)); }
  };
  return <form className="setup" onSubmit={submit}><div><p className="eyebrow">ASISTENTE LOCAL</p><h1>Prepara esta PC.</h1><p className="lede">Las rutas y secretos se guardan sólo aquí. Windows cifra los tokens antes de almacenarlos.</p></div><div className="form-grid"><label>Tu nombre<input required value={config.playerName} onChange={(e) => update('playerName', e.target.value)} placeholder="Ej. Aira"/></label><label className="highlight">ID Canal Discord<input value={config.discordChannelId || ''} onChange={(e) => update('discordChannelId', e.target.value)} placeholder="Ej. 123456789012345678"/></label><label className="highlight">Tu ID de Discord (Admin)<input value={config.adminDiscordId || ''} onChange={(e) => update('adminDiscordId', e.target.value)} placeholder="Ej. 123456789012345678 (para !cmd)"/></label><label>ID del servidor Discord (opcional)<input value={config.discordGuildId || ''} onChange={(e) => update('discordGuildId', e.target.value)} placeholder="Vacío = se detecta desde el canal"/></label><label>Ruta al data.json del tracker (opcional)<input value={config.trackerDataPath || ''} onChange={(e) => update('trackerDataPath', e.target.value)} placeholder="Vacío = <Drive>\config\tracker-mod\data.json"/></label><label className="highlight">Clave Maestra de Consola<input type="password" value={config.adminPassword || ''} onChange={(e) => update('adminPassword', e.target.value)} placeholder="Clave para desbloquear consola"/></label><label>Carpeta compartida de Google Drive<input required value={config.driveRoot} onChange={(e) => update('driveRoot', e.target.value)} placeholder="G:\Mi unidad\Minecraft"/></label><label>Ruta a MultiMC.exe<input required={!config.manualLauncher} disabled={config.manualLauncher} value={config.multiMcPath} onChange={(e) => update('multiMcPath', e.target.value)} placeholder={config.manualLauncher ? 'Opcional (Modo manual)' : 'C:\\MultiMC\\MultiMC.exe'}/></label><label>ID de instancia MultiMC<input required={!config.manualLauncher} disabled={config.manualLauncher} value={config.multiMcInstance} onChange={(e) => update('multiMcInstance', e.target.value)} placeholder={config.manualLauncher ? 'Opcional' : 'MCS'}/></label><label>Java<input required value={config.javaPath} onChange={(e) => update('javaPath', e.target.value)} placeholder="java o C:\...\java.exe"/></label><label>JAR del servidor (relativo a Drive)<input required value={config.serverJar} onChange={(e) => update('serverJar', e.target.value)}/></label><label>GitHub: propietario<input required value={config.packRepo.owner} onChange={(e) => setConfig({ ...config, packRepo: { ...config.packRepo, owner: e.target.value }, coordinationRepo: { ...config.coordinationRepo, owner: e.target.value } })}/></label><label>Repositorio pack<input required value={config.packRepo.repo} onChange={(e) => setConfig({ ...config, packRepo: { ...config.packRepo, repo: e.target.value } })}/></label><label>Repositorio coordinación<input required value={config.coordinationRepo.repo} onChange={(e) => setConfig({ ...config, coordinationRepo: { ...config.coordinationRepo, repo: e.target.value } })}/></label><label>Token GitHub<input type="password" value={config.githubToken} onChange={(e) => update('githubToken', e.target.value)} placeholder="Fine-grained token"/></label><label>Token bot Discord<input type="password" value={config.discordBotToken} onChange={(e) => update('discordBotToken', e.target.value)} placeholder="Bot token"/></label><label>Jugadores <small>Nombre: Discord ID, uno por línea</small><textarea value={playersText} onChange={(e) => { setPlayersText(e.target.value); setPlayersError(''); }} placeholder={'Aira: 123456789012345678\nAlex: 987654321098765432'}/>{playersError ? <span className="field-error">{playersError}</span> : null}</label><label>Zona horaria<input value={config.timeZone} onChange={(e) => update('timeZone', e.target.value)} placeholder="America/Argentina/Buenos_Aires"/></label><label>Puerto<input type="number" value={config.port} onChange={(e) => update('port', Number(e.target.value))}/></label><label>Memoria Java (MB)<input type="number" value={config.serverMemoryMb} onChange={(e) => update('serverMemoryMb', Number(e.target.value))}/></label><label>Backups: cada minutos<input type="number" min="5" value={config.backupIntervalMinutes} onChange={(e) => update('backupIntervalMinutes', Number(e.target.value))}/></label><label>Conservar backups<input type="number" min="1" value={config.backupRetention} onChange={(e) => update('backupRetention', Number(e.target.value))}/></label></div><label className="checkbox"><input type="checkbox" checked={Boolean(config.manualLauncher)} onChange={(e) => setConfig({ ...config, manualLauncher: e.target.checked })}/> Iniciar Minecraft manualmente</label>{config.manualLauncher ? <div style={{ margin: '-7px 0 16px' }}><label style={{ display: 'block', color: '#aab8a9', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Carpeta de la instancia (opcional, para sincronizar mods)</label><input style={{ width: '100%', border: '1px solid #4a6650', borderRadius: 6, background: '#172f24', color: '#f0f5ea', padding: 10, fontSize: 12 }} value={config.clientInstancePath || ''} onChange={(e) => update('clientInstancePath', e.target.value)} placeholder="Ej. C:\Users\...\AppData\Roaming\gdlauncher_next\instances\MCS"/></div> : null}{status?.gdLauncher ? <section className="gdlauncher"><h2>Entrar directo con GDLauncher</h2><p>GDLauncher no puede abrir una instancia en un servidor por línea de comandos. Usá su <b>Wrapper Command</b> y el juego entrará solo cuando haya un servidor activo.</p><ol><li>Abrí GDLauncher → <b>Ajustes</b> → <b>Custom Commands</b>.</li><li>Pegá esta ruta en <b>Wrapper Command</b>:</li></ol><div className="gdlauncher-cmd"><code>{status.gdLauncher.command}</code><button type="button" className="quiet" onClick={() => void window.lantern.copyText(status.gdLauncher.command)}>Copiar</button></div><small>{status.gdLauncher.target ? <>Listo: al abrir el juego entrará a <code>{status.gdLauncher.target}</code>.</> : 'Esperando un servidor activo para fijar la dirección.'}</small></section> : null}<label className="checkbox"><input type="checkbox" checked={config.isAdmin} onChange={(e) => setConfig({ ...config, isAdmin: e.target.checked })}/> Esta PC puede publicar una versión de pack.</label><button className="primary" disabled={busy}>Guardar configuración</button>{config.isAdmin ? <section className="publisher"><h2>Publicar manifiesto</h2><p>Pegá el manifiesto ya validado; GitHub mantendrá una única versión vigente.</p><textarea value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder={'{"version":"1.0.0","loader":"fabric", ...}'}/><button type="button" className="quiet" disabled={!manifest || busy} onClick={async () => { try { await window.lantern.publishPack(JSON.parse(manifest)); setManifest(''); alert('Manifiesto publicado.'); } catch (error) { alert(toastError(error)); } }}>Publicar pack</button></section> : null}</form>;
}

function BackupView({ backups, busy, onRestore }: { backups: string[]; busy: boolean; onRestore: (name: string) => void }) { return <section className="backups"><p className="eyebrow">RECUPERACIÓN</p><h1>Backups del mundo</h1><p className="lede">Restaurar nunca sobrescribe el mundo actual: primero lo mueve a <code>conflicts</code>.</p><div className="backup-list">{backups.length ? backups.map((backup) => <div className="backup" key={backup}><span>{backup.replace(/-/g, ' ')}</span><button className="quiet" disabled={busy} onClick={() => onRestore(backup)}>Restaurar</button></div>) : <div className="empty">Todavía no hay backups en Google Drive.</div>}</div></section>; }
