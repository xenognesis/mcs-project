import { FormEvent, useCallback, useEffect, useState } from 'react';

const emptyConfig = (): AppConfig => ({ playerName: '', isAdmin: false, githubToken: '', discordBotToken: '', discordChannelId: '', discordGuildId: '', releasesChannelId: '', trackerDataPath: '', adminPassword: '', adminDiscordId: '', manualLauncher: false, clientInstancePath: '', radminPath: '', packRepo: { owner: '', repo: 'minecraft-pack', branch: 'main' }, coordinationRepo: { owner: '', repo: 'minecraft-coordination', branch: 'main' }, driveRoot: '', multiMcPath: '', multiMcInstance: 'shared-server', javaPath: 'java', serverJar: 'server.jar', serverMemoryMb: 4096, port: 25565, players: [], backupIntervalMinutes: 60, backupRetention: 20, fullBackupRetention: 2, testDriveRoot: '', testPort: 25566, testMultiMcInstance: 'MCS-TESTS', testServerJar: '', testServerMemoryMb: 0, testBackupIntervalMinutes: 0, testBackupRetention: 1, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } as AppConfig);

function toastError(error: unknown) { return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null); const [config, setConfig] = useState<AppConfig>(emptyConfig); const [screen, setScreen] = useState<'home' | 'setup' | 'backups'>('home');
  const [notice, setNotice] = useState(''); const [pending, setPending] = useState<string[]>([]); const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const refresh = useCallback(async () => { const next = await window.lantern.status(); setStatus(next); setUpdate(next.update); }, []);
  useEffect(() => { void Promise.all([refresh(), window.lantern.config.get().then(setConfig)]); window.lantern.onLog(() => void refresh()); window.lantern.onServerState(() => void refresh()); window.lantern.onUpdateState(setUpdate); const id = window.setInterval(() => void refresh(), 30_000); return () => clearInterval(id); }, [refresh]);
  // El aviso de "estás al día" es transitorio; las demás fases quedan hasta que cambien.
  useEffect(() => { if (update?.phase !== 'current') return; const id = window.setTimeout(() => setUpdate({ phase: 'idle' }), 5000); return () => window.clearTimeout(id); }, [update]);
  // Cada acción bloquea sólo los controles que podrían chocar con ella; el resto sigue disponible.
  const isPending = useCallback((key: string) => pending.includes(key), [pending]);
  const addPending = (keys: string[]) => setPending((current) => [...new Set([...current, ...keys])]);
  const removePending = (keys: string[]) => setPending((current) => current.filter((key) => !keys.includes(key)));
  const guard = async (key: string, work: () => Promise<unknown>) => {
    addPending([key]);
    try { await work(); } finally { removePending([key]); }
  };
  const action = async (key: string | string[], work: () => Promise<unknown>, success: string) => {
    const keys = Array.isArray(key) ? key : [key];
    addPending(keys);
    try { await work(); setNotice(success); await refresh(); } catch (error) { setNotice(toastError(error)); } finally { removePending(keys); }
  };
  const checkUpdate = () => { void guard('update:check', () => window.lantern.checkUpdate()).catch(() => undefined); };
  const installUpdate = () => { void guard('update:install', () => window.lantern.installUpdate()).catch((error) => setNotice(toastError(error))); };
  const survivalState = status?.hosts?.find((host) => host.kind === 'survival')?.server ?? status?.server ?? 'stopped';
  const testsState = status?.hosts?.find((host) => host.kind === 'tests')?.server ?? 'stopped';
  const overall = survivalState === 'starting' || testsState === 'starting' ? 'starting' : survivalState !== 'stopped' || testsState !== 'stopped' ? 'running' : 'stopped';
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="lantern">◈</span><div><strong>Lantern Host</strong><small>Servidor compartido · Fabric</small></div></div><nav><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>Centro de control</button><button className={screen === 'backups' ? 'active' : ''} onClick={() => { setScreen('backups'); void window.lantern.backups().then(setBackups); }}>Backups</button><button className={screen === 'setup' ? 'active' : ''} onClick={() => setScreen('setup')}>Configuración</button></nav><button className="quiet version" title="Buscar actualizaciones" onClick={checkUpdate} disabled={isPending('update:check')}>v{status?.version ?? '—'}</button><span className={`pill ${overall}`}>{overall === 'running' ? 'Servidor en línea' : overall === 'starting' ? 'Iniciando' : 'En espera'}</span></header>
    <UpdateBar update={update} busy={isPending('update:install')} onCheck={checkUpdate} onInstall={installUpdate} />
    {notice ? <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div> : null}
    {screen === 'home' ? <Dashboard status={status} config={config} isPending={isPending} onAction={action} onRefresh={refresh} onNotice={setNotice} /> : null}
    {screen === 'setup' ? <Setup config={config} setConfig={setConfig} busy={isPending('config')} status={status} onSave={(next) => action('config', async () => { setConfig(next); await window.lantern.config.save(next); }, 'Configuración guardada y secretos protegidos por Windows.')} /> : null}
    {screen === 'backups' ? <BackupView backups={backups} busy={isPending('backup')} onRestore={(name) => action('backup', async () => { if (!confirm(`Se archivará el mundo actual y se restaurará ${name}.`)) return; await window.lantern.restore(name); }, 'Backup restaurado y verificado; el mundo previo quedó archivado en conflicts.')} /> : null}
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

function Dashboard({ status, config, isPending, onAction, onRefresh, onNotice }: {
  status: AppStatus | null;
  config: AppConfig;
  isPending: (key: string) => boolean;
  onAction: (key: string | string[], task: () => Promise<unknown>, message: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  // Radmin VPN ya no bloquea: si está apagado, la app lo enciende al iniciar o unirse.
  const canStart = Boolean(status?.requirements.every((item) => item.ok || item.name === 'Radmin VPN'));
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
      await onAction('publish', () => window.lantern.publishWorld(), 'Mundo actual publicado como nueva base.');
    } catch (error) {
      setPublishError(toastError(error));
    } finally { setPublishing(false); }
  };
  const copyTestsWorld = () => {
    if (!confirm('Se reemplazará el mundo de pruebas actual con una copia del mundo survival más reciente. Se perderá el progreso del mundo de pruebas. Para una copia consistente, el servidor survival debería estar detenido. ¿Continuar?')) return;
    void onAction('copy-tests-world', () => window.lantern.copyTestsWorld(), 'Mundo survival copiado y pack de pruebas sincronizado. Ya podés iniciar el mundo de pruebas.');
  };

  const hosts = status?.hosts ?? [];
  const survivalHost = hosts.find((host) => host.kind === 'survival');
  const testsHost = hosts.find((host) => host.kind === 'tests');
  const survivalState = survivalHost?.server ?? status?.server ?? 'stopped';
  const survivalOwned = survivalState !== 'stopped';
  const survivalLease = survivalOwned ? null : survivalHost?.lease ?? status?.lease ?? null;
  const testsState = testsHost?.server ?? 'stopped';
  const testsOwned = testsState !== 'stopped';
  const testsLease = testsOwned ? null : testsHost?.lease ?? null;
  const survivalActionPending = isPending('server:survival');
  const survivalPending = survivalActionPending || isPending('sync');
  const testsActionPending = isPending('server:tests');
  const copyTestsPending = isPending('copy-tests-world');
  const testsPending = testsActionPending;

  return <section className="dashboard">
    <div className="hero"><div><p className="eyebrow">MUNDO COMPARTIDO / RADMIN VPN</p><h1>Todo listo para<br/><em>encender la fogata.</em></h1><p className="lede">Un anfitrión, una copia fiable del mundo y una ruta clara para que los demás entren.</p></div><div className="world-card"><span>Estado del mundo</span><strong>{status?.localWorldHash && status.localWorldHash === status.publishedWorldHash ? 'Sincronizado' : 'Requiere atención'}</strong><small>{status?.localWorldHash ? `Hash ${status.localWorldHash.slice(0, 12)}` : 'Aún no hay mundo configurado'}</small>{status?.localWorldHash && status.localWorldHash !== status.publishedWorldHash && survivalState === 'stopped' ? <div className="world-publish-area"><button className="quiet world-publish" disabled={survivalPending || isPending('publish') || publishing} title="Declarar el mundo actual como la nueva base publicada" onClick={() => { if (!confirm('Se declarará el mundo actual como la nueva base publicada. Hacelo sólo si reemplazaste el mundo a propósito; el resto de los jugadores deberá sincronizar esta copia. ¿Continuar?')) return; if (status?.consoleUnlocked) { void onAction('publish', () => window.lantern.publishWorld(), 'Mundo actual publicado como nueva base.'); } else { setPublishError(''); setPublishNeedsKey(true); } }}>Publicar mundo actual</button>{publishNeedsKey ? <form className="world-unlock" onSubmit={submitPublish}><input type="password" placeholder="Clave maestra para publicar..." value={publishPassword} onChange={(e) => { setPublishPassword(e.target.value); setPublishError(''); }} disabled={publishing} autoComplete="current-password"/><button type="submit" className="quiet" disabled={publishing || !publishPassword.trim()}>{publishing ? 'Verificando…' : 'Desbloquear y publicar'}</button></form> : null}{publishError ? <span className="field-error">{publishError}</span> : null}</div> : null}</div></div>
    <div className="actions">
      {survivalOwned
        ? <button className="primary danger" disabled={survivalPending || survivalState !== 'running'} onClick={() => void onAction('server:survival', () => window.lantern.stop(), 'Servidor detenido, mundo guardado y backup final creado.')}>{survivalState === 'starting' ? 'Iniciando servidor…' : survivalState === 'stopping' ? 'Deteniendo servidor…' : 'Detener y guardar'}</button>
        : survivalLease
        ? <><button className="primary" disabled={survivalPending} onClick={() => void onAction('server:survival', () => window.lantern.join(), config.manualLauncher ? 'IP copiada. Abrí tu launcher y entrá al servidor.' : `Abriendo MultiMC para unirse a ${survivalLease.hostName}.`)}>{survivalActionPending ? 'Abriendo…' : 'Unirse al servidor'}</button><span>Activo por <b>{survivalLease.hostName}</b> · {survivalLease.ip}:{survivalLease.port}</span></>
        : <button className="primary" disabled={survivalPending || !canStart} onClick={() => void onAction('server:survival', () => window.lantern.start(), config.manualLauncher ? 'Servidor iniciado. IP copiada. Abrí tu launcher y entrá al servidor.' : 'Servidor iniciado. MultiMC se abrirá automáticamente.')}>{survivalActionPending ? 'Iniciando servidor…' : 'Iniciar servidor y jugar'}</button>}
      <button className="quiet" disabled={survivalPending || isPending('sync')} onClick={() => void onAction('sync', () => window.lantern.sync(), 'Pack verificado y actualizado.')}>{isPending('sync') ? 'Sincronizando…' : 'Sincronizar pack'}</button>
      <button className="quiet" disabled={isPending('copy-ip')} onClick={() => void onAction('copy-ip', async () => { const ip = await window.lantern.copyIp(); if (!ip) throw new Error('No se detectó la IP de Radmin VPN.'); }, 'IP de Radmin copiada.')}>{isPending('copy-ip') ? 'Copiando…' : 'Copiar IP Radmin'}</button>
    </div>
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-title"><h2>Mundo de pruebas (creativo) · Puerto {config.testPort || 25566}</h2><span>{testsOwned ? (testsState === 'starting' ? 'Iniciando' : testsState === 'stopping' ? 'Deteniendo' : 'En línea') : 'En espera'}</span></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 20px', flexWrap: 'wrap' }}>
        {testsOwned
          ? <button className="primary danger" disabled={testsPending || testsState !== 'running'} onClick={() => void onAction('server:tests', () => window.lantern.stop('tests'), 'Servidor de pruebas detenido.')}>{testsState === 'starting' ? 'Iniciando pruebas…' : testsState === 'stopping' ? 'Deteniendo pruebas…' : 'Detener pruebas'}</button>
          : testsLease
          ? <button className="primary" disabled={testsPending} onClick={() => void onAction('server:tests', () => window.lantern.join('tests'), 'Abriendo para unirse a pruebas.')}>{testsActionPending ? 'Abriendo…' : 'Unirse a pruebas'}</button>
          : <button className="primary" disabled={testsPending || copyTestsPending || !canStart} onClick={() => void onAction('server:tests', () => window.lantern.start('tests'), 'Servidor de pruebas iniciado.')}>{testsActionPending ? 'Iniciando pruebas…' : 'Iniciar mundo de pruebas'}</button>}
        <button className="quiet" disabled={testsOwned || Boolean(testsLease) || testsPending || copyTestsPending || !canStart} onClick={copyTestsWorld}>{copyTestsPending ? 'Copiando mundo y sincronizando…' : 'Copiar mundo survival'}</button>
        <span style={{ color: '#bdc9bc', fontSize: 12 }}>{copyTestsPending ? 'Copiando todos los archivos del mundo y sincronizando el pack. No se puede iniciar pruebas hasta terminar.' : testsHost?.hasWorld ? 'El botón reemplaza el mundo de pruebas actual por el survival más reciente. Se puede iniciar cuando termine.' : 'Todavía no hay mundo de pruebas: el primero se copiará automáticamente del survival al iniciar.'}</span>
        <span style={{ color: '#bdc9bc', fontSize: 12 }}>Instancia: {config.testMultiMcInstance || 'MCS-TESTS'} · Drive: {(config.testDriveRoot?.trim()) || (config.driveRoot ? config.driveRoot.replace(/MCS$/i, 'MCS-TESTS') : 'G:\\Mi Unidad\\MCS-TESTS')}</span>
      </div>
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
  const update = (key: keyof AppConfig, value: string | number | boolean) => setConfig({ ...config, [key]: value } as AppConfig);
  const [manifest, setManifest] = useState('');
  const [playersText, setPlayersText] = useState(() => playersToText(config.players));
  const [playersError, setPlayersError] = useState('');
  useEffect(() => setPlayersText(playersToText(config.players)), [config.players]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try { setPlayersError(''); onSave({ ...config, players: parsePlayers(playersText) }); }
    catch (error) { setPlayersError(toastError(error)); }
  };
  return <form className="setup" onSubmit={submit}><div><p className="eyebrow">ASISTENTE LOCAL</p><h1>Prepara esta PC.</h1><p className="lede">Las rutas y secretos se guardan sólo aquí. Windows cifra los tokens antes de almacenarlos.</p></div><div className="form-grid"><label>Tu nombre<input required value={config.playerName} onChange={(e) => update('playerName', e.target.value)} placeholder="Ej. Aira"/></label><label className="highlight">ID Canal Discord<input value={config.discordChannelId || ''} onChange={(e) => update('discordChannelId', e.target.value)} placeholder="Ej. 123456789012345678"/></label><label className="highlight">Tu ID de Discord (Admin)<input value={config.adminDiscordId || ''} onChange={(e) => update('adminDiscordId', e.target.value)} placeholder="Ej. 123456789012345678 (para !cmd)"/></label><label>ID del servidor Discord (opcional)<input value={config.discordGuildId || ''} onChange={(e) => update('discordGuildId', e.target.value)} placeholder="Vacío = se detecta desde el canal"/></label><label className="highlight">ID Canal de avisos de versión<input value={config.releasesChannelId || ''} onChange={(e) => update('releasesChannelId', e.target.value)} placeholder="Ej. 1561576254111613040 (avisa «Versión X.X.X ya disponible»)"/></label><label>Ruta al data.json del tracker (opcional)<input value={config.trackerDataPath || ''} onChange={(e) => update('trackerDataPath', e.target.value)} placeholder="Vacío = <Drive>\config\tracker-mod\data.json"/></label><label className="highlight">Clave Maestra de Consola<input type="password" value={config.adminPassword || ''} onChange={(e) => update('adminPassword', e.target.value)} placeholder="Clave para desbloquear consola"/></label><label>Carpeta compartida de Google Drive<input required value={config.driveRoot} onChange={(e) => update('driveRoot', e.target.value)} placeholder="G:\Mi unidad\MCS"/></label><label>Ruta a MultiMC.exe<input required={!config.manualLauncher} disabled={config.manualLauncher} value={config.multiMcPath} onChange={(e) => update('multiMcPath', e.target.value)} placeholder={config.manualLauncher ? 'Opcional (Modo manual)' : 'C:\\MultiMC\\MultiMC.exe'}/></label><label>Ruta a Radmin VPN (opcional)<input value={config.radminPath || ''} onChange={(e) => update('radminPath', e.target.value)} placeholder="Vacío = C:\\Program Files (x86)\\Radmin VPN\\RvRvpnGui.exe"/></label><label>ID de instancia MultiMC<input required={!config.manualLauncher} disabled={config.manualLauncher} value={config.multiMcInstance} onChange={(e) => update('multiMcInstance', e.target.value)} placeholder={config.manualLauncher ? 'Opcional' : 'MCS'}/></label>{config.manualLauncher ? <label>Carpeta de la instancia del launcher<small>opcional: sincroniza ahí los mods del cliente</small><input value={config.clientInstancePath || ''} onChange={(e) => update('clientInstancePath', e.target.value)} placeholder="Ej. C:\launcher\instances\MCS"/></label> : null}<label>Java<input required value={config.javaPath} onChange={(e) => update('javaPath', e.target.value)} placeholder="java o C:\...\java.exe"/></label><label>JAR del servidor (relativo a Drive)<input required value={config.serverJar} onChange={(e) => update('serverJar', e.target.value)}/></label><label>GitHub: propietario<input required value={config.packRepo.owner} onChange={(e) => setConfig({ ...config, packRepo: { ...config.packRepo, owner: e.target.value }, coordinationRepo: { ...config.coordinationRepo, owner: e.target.value } })}/></label><label>Repositorio pack<input required value={config.packRepo.repo} onChange={(e) => setConfig({ ...config, packRepo: { ...config.packRepo, repo: e.target.value } })}/></label><label>Repositorio coordinación<input required value={config.coordinationRepo.repo} onChange={(e) => setConfig({ ...config, coordinationRepo: { ...config.coordinationRepo, repo: e.target.value } })}/></label><label>Token GitHub<input type="password" value={config.githubToken} onChange={(e) => update('githubToken', e.target.value)} placeholder="Fine-grained token"/></label><label>Token bot Discord<input type="password" value={config.discordBotToken} onChange={(e) => update('discordBotToken', e.target.value)} placeholder="Bot token"/></label><label>Jugadores <small>Nombre: Discord ID, uno por línea</small><textarea value={playersText} onChange={(e) => { setPlayersText(e.target.value); setPlayersError(''); }} placeholder={'Aira: 123456789012345678\nAlex: 987654321098765432'}/>{playersError ? <span className="field-error">{playersError}</span> : null}</label><label>Zona horaria<input value={config.timeZone} onChange={(e) => update('timeZone', e.target.value)} placeholder="America/Argentina/Buenos_Aires"/></label><label>Puerto (survival)<input type="number" value={config.port} onChange={(e) => update('port', Number(e.target.value))}/></label><label>Puerto (pruebas)<input type="number" value={config.testPort || 25566} onChange={(e) => update('testPort', Number(e.target.value))}/></label><label>Instancia MultiMC pruebas<input value={config.testMultiMcInstance || 'MCS-TESTS'} onChange={(e) => update('testMultiMcInstance', e.target.value)} placeholder="MCS-TESTS"/></label><label>Carpeta drive pruebas (opcional)<input value={config.testDriveRoot || ''} onChange={(e) => update('testDriveRoot', e.target.value)} placeholder="Vacío = G:\Mi Unidad\MCS-TESTS"/></label><label>JAR servidor pruebas (opcional)<input value={config.testServerJar || ''} onChange={(e) => update('testServerJar', e.target.value)} placeholder="Vacío = usa manifest de pruebas"/></label><label>Memoria pruebas (MB, 0 = igual)<input type="number" value={config.testServerMemoryMb || 0} onChange={(e) => update('testServerMemoryMb', Number(e.target.value))}/></label><label>Memoria Java survival (MB)<input type="number" value={config.serverMemoryMb} onChange={(e) => update('serverMemoryMb', Number(e.target.value))}/></label><label>Backups incrementales survival: cada minutos<input type="number" min="5" value={config.backupIntervalMinutes} onChange={(e) => update('backupIntervalMinutes', Number(e.target.value))}/></label><label>Backups pruebas: cada minutos (0 = mismo)<input type="number" min="0" value={config.testBackupIntervalMinutes || 0} onChange={(e) => update('testBackupIntervalMinutes', Number(e.target.value))}/></label><label>Incrementales a conservar survival<input type="number" min="1" value={config.backupRetention} onChange={(e) => update('backupRetention', Number(e.target.value))}/></label><label>Incrementales a conservar pruebas<input type="number" min="1" value={config.testBackupRetention || 1} onChange={(e) => update('testBackupRetention', Number(e.target.value))}/></label><label>Completos a conservar<input type="number" min="1" value={config.fullBackupRetention} onChange={(e) => update('fullBackupRetention', Number(e.target.value))}/></label></div><label className="checkbox"><input type="checkbox" checked={Boolean(config.manualLauncher)} onChange={(e) => setConfig({ ...config, manualLauncher: e.target.checked })}/> Iniciar Minecraft manualmente</label><label className="checkbox"><input type="checkbox" checked={config.isAdmin} onChange={(e) => setConfig({ ...config, isAdmin: e.target.checked })}/> Esta PC puede publicar una versión de pack.</label><button className="primary" disabled={busy}>Guardar configuración</button>{config.isAdmin ? <section className="publisher"><h2>Publicar manifiesto</h2><p>Pegá el manifiesto ya validado; GitHub mantendrá una única versión vigente.</p><textarea value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder={'{"version":"1.0.0","loader":"fabric", ...}'}/><button type="button" className="quiet" disabled={!manifest || busy} onClick={async () => { try { await window.lantern.publishPack(JSON.parse(manifest)); setManifest(''); alert('Manifiesto publicado.'); } catch (error) { alert(toastError(error)); } }}>Publicar pack</button></section> : null}</form>;
}

function formatBackupName(name: string) { const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}Z?-(.+)$/.exec(name); return match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]} · ${match[5]}` : name; }
function formatSize(bytes: number) { return `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`; }
function backupDetail(backup: BackupEntry) { return backup.kind === 'incremental' ? `incremental${backup.addedBytes ? ` · +${formatSize(backup.addedBytes)}` : ''}` : `completo${backup.bytes ? ` · ${formatSize(backup.bytes)}` : ''}`; }
function BackupView({ backups, busy, onRestore }: { backups: BackupEntry[]; busy: boolean; onRestore: (name: string) => void }) { return <section className="backups"><p className="eyebrow">RECUPERACIÓN</p><h1>Backups del mundo</h1><p className="lede">Los backups por hora son incrementales: guardan sólo lo que cambió desde el anterior. Al cerrar el servidor se guarda uno completo y autocontenido. Restaurar nunca sobrescribe el mundo actual: primero lo mueve a <code>conflicts</code> y verifica el hash de todo lo restaurado.</p><div className="backup-list">{backups.length ? backups.map((backup) => <div className="backup" key={backup.name}><span>{formatBackupName(backup.name)}</span><small className={backup.kind}>{backupDetail(backup)}</small><button className="quiet" disabled={busy} onClick={() => onRestore(backup.name)}>Restaurar</button></div>) : <div className="empty">Todavía no hay backups en Google Drive.</div>}</div></section>; }
