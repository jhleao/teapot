import { IPC_CHANNELS, IpcHandlerOf } from '@shared/types'
import { dialog, ipcMain } from 'electron'
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

export function registerLocalStateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getLocalRepos, getLocalReposHandler)
  ipcMain.handle(IPC_CHANNELS.selectLocalRepo, selectLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.addLocalRepo, addLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.removeLocalRepo, removeLocalRepoHandler)
  ipcMain.handle(IPC_CHANNELS.showFolderPicker, showFolderPickerHandler)
  ipcMain.handle(IPC_CHANNELS.getGithubPat, getGithubPatHandler)
  ipcMain.handle(IPC_CHANNELS.setGithubPat, setGithubPatHandler)
}
