import { log } from '@shared/logger'
import { gitForgeService } from '../forge/service'
import { getGitAdapter } from '../git-adapter'

/**
 * Cleans up a merged branch by deleting it both locally and on the remote.
 *
 * Order of operations:
 * 1. Validate branch is not currently checked out
 * 2. Attempt to delete remote branch (gracefully handles failures)
 * 3. Delete local branch
 *
 * If remote deletion fails (no PAT, branch already deleted, etc.), we continue
 * with local deletion. This ensures the cleanup completes even if GitHub is
 * unavailable or the remote branch was already cleaned up.
 *
 * @param repoPath - Path to the repository
 * @param branchName - Name of the branch to cleanup
 * @throws Error if trying to delete current branch or local deletion fails
 */
export async function cleanupBranch(repoPath: string, branchName: string): Promise<void> {
  const git = getGitAdapter()

  // Validate: cannot delete current branch
  const currentBranch = await git.currentBranch(repoPath)
  if (currentBranch === branchName) {
    throw new Error('Cannot delete the currently checked out branch')
  }

  // Step 1: Attempt remote deletion (best effort)
  try {
    await gitForgeService.deleteRemoteBranch(repoPath, branchName)
    log.info(`Deleted remote branch: ${branchName}`)
  } catch (error) {
    // Log but don't fail - remote might not exist, no PAT, etc.
    log.warn(`Failed to delete remote branch (continuing with local): ${branchName}`, error)
  }

  // Step 2: Delete local branch
  await git.deleteBranch(repoPath, branchName)
  log.info(`Deleted local branch: ${branchName}`)
}
