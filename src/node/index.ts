import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { log } from '../shared/logger'
import { IPC_EVENTS } from '../shared/types'
import { registerHandlers } from './handlers'

function setupAutoUpdater(): void {
  const { autoUpdater } = electronUpdater

  autoUpdater.logger = {
    info: (msg) => log.info(`[UPDATER] ${msg}`),
    warn: (msg) => log.warn(`[UPDATER] ${msg}`),
    error: (msg) => log.error(`[UPDATER] ${msg}`),
    debug: (msg) => log.debug(`[UPDATER] ${msg}`)
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('[UPDATER] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[UPDATER] Update available:', info)
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC_EVENTS.updateDownloading, info.version)
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('[UPDATER] Update not available:', info)
  })

  autoUpdater.on('error', (err) => {
    log.error('[UPDATER] Error in auto-updater:', err)
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(
      `[UPDATER] Download progress: ${Math.round(progress.percent)}% (${progress.transferred}/${progress.total} bytes)`
    )
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[UPDATER] Update downloaded. Will install on quit:', info)
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC_EVENTS.updateDownloaded, info.version)
    })
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register all IPC handlers
  registerHandlers()

  createWindow()

  // Check for updates in production (silent download + OS notification when ready)
  if (!is.dev) {
    setupAutoUpdater()
    electronUpdater.autoUpdater.checkForUpdatesAndNotify()
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
