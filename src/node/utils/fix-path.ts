/**
 * Fix process.env.PATH for macOS Electron apps.
 *
 * When launched from Finder/Dock, Electron inherits a minimal PATH that
 * excludes user tool managers (asdf, nvm, homebrew, etc.). This breaks
 * git hooks and any subprocess that depends on those tools.
 *
 * We resolve the user's login shell PATH once via a non-interactive login
 * shell (-lc) and patch process.env.PATH so all child processes inherit it.
 */

import { execSync } from 'child_process'
import os from 'os'

if (process.platform === 'darwin') {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const resolved = execSync(`${shell} -lc 'echo $PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { HOME: os.homedir(), TERM: 'dumb' }
    }).trim()

    if (resolved) process.env.PATH = resolved
  } catch {
    // Keep current PATH
  }
}
