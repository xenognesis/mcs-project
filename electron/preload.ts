import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lantern', {
  status: () => ipcRenderer.invoke('status'), config: { get: () => ipcRenderer.invoke('config:get'), save: (value: unknown) => ipcRenderer.invoke('config:save', value) },
  sync: (kind?: 'survival' | 'tests') => ipcRenderer.invoke('sync', kind), copyTestsWorld: () => ipcRenderer.invoke('worlds:copy-tests-from-survival'), start: (kind?: 'survival' | 'tests') => ipcRenderer.invoke('server:start', kind), stop: (kind?: 'survival' | 'tests') => ipcRenderer.invoke('server:stop', kind), join: (kind?: 'survival' | 'tests') => ipcRenderer.invoke('server:join', kind), command: (cmd: string, kind?: 'survival' | 'tests') => ipcRenderer.invoke('server:command', cmd, kind),
  unlock: (password: string) => ipcRenderer.invoke('auth:unlock', password), lock: () => ipcRenderer.invoke('auth:lock'),
  publishPack: (manifest: unknown) => ipcRenderer.invoke('pack:publish', manifest),
  publishWorld: () => ipcRenderer.invoke('world:publish'),
  backups: (kind?: 'survival' | 'tests') => ipcRenderer.invoke('backups:list', kind), restore: (name: string, kind?: 'survival' | 'tests') => ipcRenderer.invoke('backups:restore', name, kind), copyIp: () => ipcRenderer.invoke('clipboard:copy-ip'), copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text), recovery: () => ipcRenderer.invoke('lease:recover-check'),
  checkUpdate: () => ipcRenderer.invoke('update:check'), installUpdate: () => ipcRenderer.invoke('update:install'),
  onLog: (listener: (line: string) => void) => ipcRenderer.on('log', (_event, line) => listener(line)), onServerState: (listener: (state: any) => void) => ipcRenderer.on('server-state', (_event, state) => listener(state)), onUpdateState: (listener: (state: unknown) => void) => ipcRenderer.on('update-state', (_event, state) => listener(state))
});
