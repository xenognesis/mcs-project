import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lantern', {
  status: () => ipcRenderer.invoke('status'), config: { get: () => ipcRenderer.invoke('config:get'), save: (value: unknown) => ipcRenderer.invoke('config:save', value) },
  sync: () => ipcRenderer.invoke('sync'), start: () => ipcRenderer.invoke('server:start'), stop: () => ipcRenderer.invoke('server:stop'), join: () => ipcRenderer.invoke('server:join'), command: (cmd: string) => ipcRenderer.invoke('server:command', cmd),
  unlock: (password: string) => ipcRenderer.invoke('auth:unlock', password), lock: () => ipcRenderer.invoke('auth:lock'),
  publishPack: (manifest: unknown) => ipcRenderer.invoke('pack:publish', manifest),
  publishWorld: () => ipcRenderer.invoke('world:publish'),
  backups: () => ipcRenderer.invoke('backups:list'), restore: (name: string) => ipcRenderer.invoke('backups:restore', name), copyIp: () => ipcRenderer.invoke('clipboard:copy-ip'), recovery: () => ipcRenderer.invoke('lease:recover-check'),
  onLog: (listener: (line: string) => void) => ipcRenderer.on('log', (_event, line) => listener(line)), onServerState: (listener: (state: string) => void) => ipcRenderer.on('server-state', (_event, state) => listener(state))
});
