/**
 * UiStateOperation - Orchestrates building the UI state from repository data.
 *
 * This operation composes services and domain logic to build the complete
 * UI state representation used by the frontend.
 */

import type { Configuration, UiState } from '@shared/types'
import { getGitAdapter, supportsGetRebaseState } from '../adapters/git'
import { RebaseStateMachine, StackAnalyzer, TrunkResolver, UiStateBuilder } from '../domain'
import { RepoModelService, SessionService } from '../services'
import { getMergedBranchNames } from '../services/MergedBranchesService'
import { createJobIdGenerator } from '../shared/job-id'
import { checkConflictResolution } from '../utils/conflict-markers'

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

    // Reconcile session state with Git reality BEFORE building UI
    // This ensures the stack is built with accurate session state
    let reconciledSession = session
    if (session) {
      const activeJobId = session.state.queue.activeJobId

      if (!workingTreeStatus.isRebasing && activeJobId) {
        // External completion detected: Git finished rebasing but session still has activeJobId
        // Use RebaseStateMachine to properly transition the state (marks job completed, clears activeJobId)
        let reconciledState = RebaseStateMachine.resumeRebaseSession({
          state: session.state,
          workingTree: workingTreeStatus,
          timestampMs: Date.now()
        })

        // When a job completes externally, we must also enqueue its descendants
        // Otherwise child branches in a stack won't be rebased
        const completedJob = session.state.jobsById[activeJobId]
        if (completedJob) {
          const node = StackAnalyzer.findNodeByBranch(session.intent, completedJob.branch)
          if (node && node.children.length > 0) {
            // Get the new HEAD SHA for the completed branch from current repo state
            const branch = repo.branches.find((b) => b.ref === completedJob.branch && !b.isRemote)
            if (branch) {
              reconciledState = RebaseStateMachine.enqueueDescendants({
                state: reconciledState,
                parent: node,
                parentNewHeadSha: branch.headSha,
                timestampMs: Date.now(),
                generateJobId: createJobIdGenerator()
              })
            }
          }
        }

        SessionService.updateState(repoPath, reconciledState)
        reconciledSession = { ...session, state: reconciledState }
      }
    }

    // Detect locally merged branches (branches whose head is ancestor of trunk) with shared cache
    const mergedBranchNames = await getMergedBranchNames(repoPath, repo, gitAdapter)

    // Build UI with local-only forge state (no PR data, just local merge detection)
    const localForgeState = { pullRequests: [], mergedBranchNames }

    const fullUiState = UiStateBuilder.buildFullUiState(repo, {
      gitForgeState: localForgeState,
      rebaseIntent: reconciledSession?.intent ?? null,
      rebaseSession: reconciledSession?.state ?? null,
      declutterTrunk
    })

    const stack = fullUiState.projectedStack ?? fullUiState.stack
    const workingTree = UiStateBuilder.buildUiWorkingTree(repo)

    // Check conflicted files for marker resolution (markers removed = resolved)
    const conflictedFiles = workingTree.filter((f) => f.status === 'conflicted')
    if (conflictedFiles.length > 0) {
      const resolutionStatus = await checkConflictResolution(
        repoPath,
        conflictedFiles.map((f) => f.path)
      )
      for (const file of workingTree) {
        if (file.status === 'conflicted') {
          file.resolved = resolutionStatus.get(file.path) ?? false
        }
      }
    }

    if (!stack) {
      return null
    }

    // Handle rebase state - apply status markers to commits
    if (reconciledSession) {
      const pendingJobIds = reconciledSession.state.queue.pendingJobIds

      if (workingTreeStatus.isRebasing) {
        // We're mid-rebase - show the appropriate status for active job
        const activeJobId = reconciledSession.state.queue.activeJobId
        const activeJob = activeJobId ? reconciledSession.state.jobsById[activeJobId] : null

        if (activeJob) {
          const hasConflicts = workingTreeStatus.conflicted.length > 0
          UiStateBuilder.applyRebaseStatusToCommits(
            stack,
            activeJob.branch,
            hasConflicts ? 'conflicted' : 'resolved'
          )
        }

        // Mark pending jobs as 'queued' - they're waiting in the queue
        for (const jobId of pendingJobIds) {
          const job = reconciledSession.state.jobsById[jobId]
          if (job?.branch) {
            UiStateBuilder.applyRebaseStatusToCommits(stack, job.branch, 'queued')
          }
        }
      } else {
        // Git is not rebasing - session was already reconciled above
        if (pendingJobIds.length > 0) {
          // Mark pending branches as 'queued' - this triggers ResumeQueueDialog
          for (const jobId of pendingJobIds) {
            const job = reconciledSession.state.jobsById[jobId]
            if (job?.branch) {
              UiStateBuilder.applyRebaseStatusToCommits(stack, job.branch, 'queued')
            }
          }
        } else if (!reconciledSession.state.queue.activeJobId) {
          // No pending jobs and no active job - rebase fully completed, cleanup
          await SessionService.clearSession(repoPath)
        }
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
