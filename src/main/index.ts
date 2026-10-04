import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startSidecar, stopSidecar } from './sidecar.js'
import { UpdateService, extractReleaseNotesSection } from './updater.js'
import type { ApiInfo } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let apiInfo: ApiInfo | null = null
const updateService = new UpdateService()

// 单实例锁
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      apiInfo = await startSidecar()
    } catch (err) {
      console.error('[sidecar] 启动失败：', err)
      dialog.showErrorBox('Awesome-Notes 启动失败', String(err))
    }
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    stopSidecar()
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', stopSidecar)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    backgroundColor: '#14161c',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  updateService.attach(mainWindow.webContents)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---- IPC ----
ipcMain.handle('api:info', () => apiInfo)

ipcMain.handle('dialog:select-folder', async () => {
  if (!mainWindow) return null
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择项目目录',
    properties: ['openDirectory']
  })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})

ipcMain.handle('shell:reveal', (_e, p: string) => {
  shell.showItemInFolder(p)
})

ipcMain.on('win:minimize', () => mainWindow?.minimize())
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('win:close', () => mainWindow?.close())

ipcMain.handle('app:version', () => app.getVersion())

// 版本更新：偏好由渲染端持久化并在初始化时传入，状态经 'update-status-changed' 推送
ipcMain.handle('update-check', () => updateService.checkForUpdates())
ipcMain.handle('update-download', () => updateService.downloadUpdate())
ipcMain.handle('update-quit-and-install', () => updateService.quitAndInstall())
ipcMain.on('update-set-prefs', (_e, prefs) => updateService.applyPrefs(prefs))

// 当前版本更新日志：release-notes.md 随包携带（extraResources），dev 下读项目根
ipcMain.handle('app:current-release-notes', () => {
  const candidates = [
    join(process.resourcesPath ?? '', 'release-notes.md'),
    join(app.getAppPath(), 'release-notes.md')
  ]
  for (const p of candidates) {
    try {
      if (p && existsSync(p)) {
        const md = readFileSync(p, 'utf-8')
        return extractReleaseNotesSection(md, app.getVersion()) ?? md.trim()
      }
    } catch {
      /* 尝试下一个候选路径 */
    }
  }
  return null
})
