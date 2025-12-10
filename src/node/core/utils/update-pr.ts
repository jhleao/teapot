import { log } from '@shared/logger'
import { gitForgeService } from '../forge/service'
import { getGitAdapter } from '../git-adapter/factory'

export async function updatePullRequest(repoPath: string, headBranch: string): Promise<void> {
  log.debug(`[updatePullRequest] Updating PR for branch: ${headBranch} in repo: ${repoPath}`)

  const adapter = getGitAdapter()

  log.debug(`[updatePullRequest] Force pushing branch ${headBranch} to origin...`)
  try {
    await adapter.push(repoPath, {
      remote: 'origin',
      ref: headBranch,
      force: true
    })

    log.debug(`[updatePullRequest] Successfully updated PR for branch ${headBranch}`)

    await gitForgeService.refresh(repoPath)
  } catch (error) {
    log.error(`[updatePullRequest] Failed to push branch ${headBranch}:`, error)
    throw new Error(
      `Failed to push branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
