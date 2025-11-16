import { ipcMain } from 'electron'

export function registerTestHandlers(): void {
  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
}
