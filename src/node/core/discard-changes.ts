import fs from 'fs'
import git from 'isomorphic-git'
import path from 'path'

export async function discardChanges(repoPath: string): Promise<void> {
  let hasHead = false

  try {
    await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    hasHead = true
  } catch {
    // No HEAD (empty repo)
    hasHead = false
  }

  if (hasHead) {
    // If we are on a branch, check out that branch to preserve it.
    // If we are in detached HEAD state, 'HEAD' will resolve to the commit SHA and keep us detached.
    const currentBranch = await git.currentBranch({ fs, dir: repoPath })
    const ref = currentBranch || 'HEAD'

    await git.checkout({
      fs,
      dir: repoPath,
      ref,
      force: true
    })
  }

  // Clean up files not in HEAD (untracked or staged-new)
  try {
    const matrix = await git.statusMatrix({ fs, dir: repoPath })

    for (const row of matrix) {
      const [filepath, headStatus, workdirStatus] = row

      // headStatus === 0 means file is not in HEAD
      // workdirStatus !== 0 means file is present in working directory
      if (headStatus === 0 && workdirStatus !== 0) {
        const fullPath = path.join(repoPath, filepath)
        try {
          await fs.promises.rm(fullPath, { force: true, recursive: true })
        } catch (e) {
          // Ignore errors
          console.error(`Failed to remove ${fullPath}:`, e)
        }
      }
    }
  } catch {
    // Ignore errors if statusMatrix fails
  }
}
