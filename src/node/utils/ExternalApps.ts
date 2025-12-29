/**
 * ExternalApps - Utility for launching external applications
 *
 * Handles opening paths in:
 * - Code editors (VS Code, etc.)
 * - Terminal emulators
 * - File managers
 */

import { exec } from 'child_process'
import { clipboard, shell } from 'electron'
import { promisify } from 'util'

import { log } from '@shared/logger'

const execAsync = promisify(exec)

export type ExternalAppResult = {
  success: boolean
  error?: string
}

export class ExternalApps {
  /**
   * Open a path in the configured code editor.
   * @param targetPath - The path to open
   * @param editorCommand - Optional editor command (defaults to 'code' for VS Code)
   */
  static async openInEditor(
    targetPath: string,
    editorCommand?: string
  ): Promise<ExternalAppResult> {
    const editor = editorCommand || 'code'
    try {
      await execAsync(`${editor} "${targetPath}"`)
      return { success: true }
    } catch (error) {
      log.error(`[ExternalApps.openInEditor] Failed:`, error)
      return {
        success: false,
        error: `Editor '${editor}' not found. Check your Preferred Editor setting.`
      }
    }
  }

  /**
   * Open a path in the system terminal emulator.
   * Uses platform-specific commands.
   */
  static async openInTerminal(path: string): Promise<ExternalAppResult> {
    try {
      if (process.platform === 'darwin') {
        await execAsync(`open -a Terminal "${path}"`)
      } else if (process.platform === 'win32') {
        await execAsync(`start cmd /K "cd /d ${path}"`)
      } else {
        // Linux - try common terminals
        try {
          await execAsync(`gnome-terminal --working-directory="${path}"`)
        } catch {
          await execAsync(`xterm -e "cd ${path} && $SHELL"`)
        }
      }
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[ExternalApps.openInTerminal] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Open a path in the system file manager (Finder, Explorer, etc.).
   */
  static async openInFileManager(path: string): Promise<ExternalAppResult> {
    try {
      await shell.openPath(path)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[ExternalApps.openInFileManager] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Copy a path to the system clipboard.
   */
  static copyToClipboard(text: string): ExternalAppResult {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[ExternalApps.copyToClipboard] Failed:`, error)
      return { success: false, error: message }
    }
  }
}
