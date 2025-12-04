import { log } from '@shared/logger'
import fs from 'fs'
import path from 'path'
import { getGitAdapter } from './git-adapter'

export async function discardChanges(repoPath: string): Promise<void> {
  const git = getGitAdapter()
  let hasHead = false

  try {
    await git.resolveRef(repoPath, 'HEAD')
    hasHead = true
  } catch {
    // No HEAD (empty repo)
    hasHead = false
  }

  if (hasHead) {
    // If we are on a branch, check out that branch to preserve it.
    // If we are in detached HEAD state, 'HEAD' will resolve to the commit SHA and keep us detached.
    const currentBranch = await git.currentBranch(repoPath)
    const ref = currentBranch || 'HEAD'

    await git.checkout(repoPath, ref, { force: true })
  }

  // Clean up files not in HEAD (untracked or staged-new)
  try {
    const status = await git.getWorkingTreeStatus(repoPath)

    // Remove untracked files (not_added) and newly created files
    const filesToRemove = [...status.not_added, ...status.created]

    for (const filepath of filesToRemove) {
      const fullPath = path.join(repoPath, filepath)
      try {
        await fs.promises.rm(fullPath, { force: true, recursive: true })
      } catch (e) {
        // Ignore errors
        log.error(`Failed to remove ${fullPath}:`, e)
      }
    }
  } catch {
    // Ignore errors if status fails
  }
}
