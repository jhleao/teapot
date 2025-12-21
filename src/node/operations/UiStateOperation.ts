/**
 * UiStateOperation - Orchestrates building the UI state from repository data.
 *
 * This operation composes services and domain logic to build the complete
 * UI state representation used by the frontend.
 */

import type { Configuration, UiState } from '@shared/types'
import { getGitAdapter, supportsGetRebaseState } from '../adapters/git'
import { TrunkResolver, UiStateBuilder } from '../domain'
import { RepoModelService, SessionService } from '../services'
import { getMergedBranchNames } from '../services/MergedBranchesService'

export type GetUiStateOptions = {
  declutterTrunk?: boolean
}

export class UiStateOperation {
  /**
   * Builds the UI state from local git data only.
   * Does NOT fetch forge state - this ensures local operations are never blocked by network.
   * Forge state should be fetched separately via getForgeState IPC handler.
   */
  static async getUiState(
    repoPath: string,
    options: GetUiStateOptions = {}
  ): Promise<UiState | null> {
    const { declutterTrunk } = options
    const config: Configuration = { repoPath }
    const gitAdapter = getGitAdapter()

    // Only fetch local git data - no network calls here
    const [repo, session] = await Promise.all([
      RepoModelService.buildRepoModel(config),
      SessionService.getSession(repoPath)
    ])

    const workingTreeStatus = repo.workingTreeStatus

    // Detect locally merged branches (branches whose head is ancestor of trunk) with shared cache
    const mergedBranchNames = await getMergedBranchNames(repoPath, repo, gitAdapter)

    // Build UI with local-only forge state (no PR data, just local merge detection)
    const localForgeState = { pullRequests: [], mergedBranchNames }

    const fullUiState = UiStateBuilder.buildFullUiState(repo, {
      gitForgeState: localForgeState,
      rebaseIntent: session?.intent ?? null,
      rebaseSession: session?.state ?? null,
      declutterTrunk
    })

    let stack = fullUiState.projectedStack ?? fullUiState.stack
    const workingTree = UiStateBuilder.buildUiWorkingTree(repo)

    if (!stack) {
      return null
    }

    // Handle rebase state
    if (session) {
      if (workingTreeStatus.isRebasing) {
        // We're mid-rebase - show the appropriate status
        const activeJobId = session.state.queue.activeJobId
        const activeJob = activeJobId ? session.state.jobsById[activeJobId] : null

        if (activeJob) {
          const hasConflicts = workingTreeStatus.conflicted.length > 0
          UiStateBuilder.applyRebaseStatusToCommits(
            stack,
            activeJob.branch,
            hasConflicts ? 'conflicted' : 'resolved'
          )
        }
      } else {
        // Git is no longer rebasing but we have a session - external tool completed the rebase
        // Clean up the stale session
        await SessionService.clearSession(repoPath)
      }
    } else if (workingTreeStatus.isRebasing) {
      // Git is rebasing but we have no session - this is an orphaned rebase
      // (e.g., the app was restarted mid-rebase, or rebase started externally)
      // Try to recover the branch name from Git's rebase state
      if (supportsGetRebaseState(gitAdapter)) {
        const gitRebaseState = await gitAdapter.getRebaseState(repoPath)
        if (gitRebaseState?.branch) {
          const hasConflicts = workingTreeStatus.conflicted.length > 0
          UiStateBuilder.applyRebaseStatusToCommits(
            stack,
            gitRebaseState.branch,
            hasConflicts ? 'conflicted' : 'resolved'
          )
        }
      }
    }

    const trunkHeadSha = TrunkResolver.getTrunkHeadSha(repo.branches, repo.commits)
    return { stack, workingTree, trunkHeadSha }
  }
}
