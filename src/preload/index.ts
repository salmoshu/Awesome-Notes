import { contextBridge, ipcRenderer } from 'electron'
import type { AwesomeNotesBridge, UpdateStatusEvent } from '@shared/types'

const bridge: AwesomeNotesBridge = {
  getApiInfo: () => ipcRenderer.invoke('api:info'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  revealPath: (p: string) => ipcRenderer.invoke('shell:reveal', p),
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winToggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  winClose: () => ipcRenderer.send('win:close'),
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke('app:version'),
  updaterCheck: () => ipcRenderer.invoke('update-check'),
  updaterDownload: () => ipcRenderer.invoke('update-download'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('update-quit-and-install'),
  updaterSetPrefs: (prefs) => ipcRenderer.send('update-set-prefs', prefs),
  getCurrentReleaseNotes: () => ipcRenderer.invoke('app:current-release-notes'),
  onUpdateStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: UpdateStatusEvent) => cb(payload)
    ipcRenderer.on('update-status-changed', listener)
    return () => ipcRenderer.removeListener('update-status-changed', listener)
  }
}

contextBridge.exposeInMainWorld('awesomeNotes', bridge)
