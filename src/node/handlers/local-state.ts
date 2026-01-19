import { IPC_CHANNELS, IpcHandlerOf } from '@shared/types'
import { clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { CloneOperation } from '../operations/CloneOperation'
import { gitForgeService } from '../services/ForgeService'
import { configStore } from '../store'

const getLocalReposHandler: IpcHandlerOf<'getLocalRepos'> = () => {
  return configStore.getLocalRepos()
}

const selectLocalRepoHandler: IpcHandlerOf<'selectLocalRepo'> = (_event, { path }) => {
  return configStore.selectLocalRepo(path)
}

const addLocalRepoHandler: IpcHandlerOf<'addLocalRepo'> = (_event, { path }) => {
  return configStore.addLocalRepo(path)
}

const removeLocalRepoHandler: IpcHandlerOf<'removeLocalRepo'> = (_event, { path }) => {
  return configStore.removeLocalRepo(path)
}

const showFolderPickerHandler: IpcHandlerOf<'showFolderPicker'> = async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Repository Folder'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

const getGithubPatHandler: IpcHandlerOf<'getGithubPat'> = () => {
  return configStore.getGithubPat() ?? null
}

const setGithubPatHandler: IpcHandlerOf<'setGithubPat'> = (_event, { token }) => {
  configStore.setGithubPat(token)
  gitForgeService.invalidateAll()
}

const getPreferredEditorHandler: IpcHandlerOf<'getPreferredEditor'> = () => {
  return configStore.getPreferredEditor() ?? null
}

const setPreferredEditorHandler: IpcHandlerOf<'setPreferredEditor'> = (_event, { editor }) => {
  configStore.setPreferredEditor(editor)
}

const getFileLogLevelHandler: IpcHandlerOf<'getFileLogLevel'> = () => {
  return configStore.getFileLogLevel()
}

const setFileLogLevelHandler: IpcHandlerOf<'setFileLogLevel'> = (_event, { level }) => {
  configStore.setFileLogLevel(level)
}

const showDebugLogFileHandler: IpcHandlerOf<'showDebugLogFile'> = () => {
  const repoPath = configStore.getSelectedRepoPath()
  if (!repoPath) {
    return { success: false, error: 'No repository open' }
  }

  const logPath = path.join(repoPath, '.git', 'teapot-debug.log')

  // Create the file if it doesn't exist so we have something to show
  if (!fs.existsSync(logPath)) {
    try {
      fs.writeFileSync(logPath, '')
    } catch {
      return { success: false, error: 'Could not create log file' }
    }
  }

  shell.showItemInFolder(logPath)
  return { success: true }
}

const getMergeStrategyHandler: IpcHandlerOf<'getMergeStrategy'> = () => {
  return configStore.getMergeStrategy()
}

const setMergeStrategyHandler: IpcHandlerOf<'setMergeStrategy'> = (_event, { strategy }) => {
  configStore.setMergeStrategy(strategy)
}

const cloneRepositoryHandler: IpcHandlerOf<'cloneRepository'> = async (
  _event,
  { url, targetPath, folderName }
) => {
  const result = await CloneOperation.clone(url, targetPath, folderName)
  if (result.success) {
    configStore.setLastClonePath(targetPath)
  }
  return result
}

const checkCloneFolderNameHandler: IpcHandlerOf<'checkCloneFolderName'> = async (
  _event,
  { targetPath, folderName }
) => {
  return CloneOperation.checkFolderName(targetPath, folderName)
}

const checkTargetPathHandler: IpcHandlerOf<'checkTargetPath'> = async (_event, { targetPath }) => {
  return CloneOperation.checkTargetPath(targetPath)
}

const getLastClonePathHandler: IpcHandlerOf<'getLastClonePath'> = () => {
  return configStore.getLastClonePath() ?? null
}

const readClipboardTextHandler: IpcHandlerOf<'readClipboardText'> = () => {
  return clipboard.readText()
}

export function registerLocalStateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getLocalRepos, getLocalReposHandler)
  ipcMain.handle(IPC_CHANNELS.selectLocalRepo, selectLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.addLocalRepo, addLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.removeLocalRepo, removeLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.showFolderPicker, showFolderPickerHandler)
  ipcMain.handle(IPC_CHANNELS.getGithubPat, getGithubPatHandler)
  ipcMain.handle(IPC_CHANNELS.setGithubPat, setGithubPatHandler)
  ipcMain.handle(IPC_CHANNELS.getPreferredEditor, getPreferredEditorHandler)
  ipcMain.handle(IPC_CHANNELS.setPreferredEditor, setPreferredEditorHandler)
  ipcMain.handle(IPC_CHANNELS.getFileLogLevel, getFileLogLevelHandler)
  ipcMain.handle(IPC_CHANNELS.setFileLogLevel, setFileLogLevelHandler)
  ipcMain.handle(IPC_CHANNELS.showDebugLogFile, showDebugLogFileHandler)
  ipcMain.handle(IPC_CHANNELS.getMergeStrategy, getMergeStrategyHandler)
  ipcMain.handle(IPC_CHANNELS.setMergeStrategy, setMergeStrategyHandler)
  ipcMain.handle(IPC_CHANNELS.cloneRepository, cloneRepositoryHandler)
  ipcMain.handle(IPC_CHANNELS.getLastClonePath, getLastClonePathHandler)
  ipcMain.handle(IPC_CHANNELS.readClipboardText, readClipboardTextHandler)
  ipcMain.handle(IPC_CHANNELS.checkCloneFolderName, checkCloneFolderNameHandler)
  ipcMain.handle(IPC_CHANNELS.checkTargetPath, checkTargetPathHandler)
}
