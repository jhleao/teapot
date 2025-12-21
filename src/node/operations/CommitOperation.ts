/**
 * CommitOperation - Orchestrates commit-related operations
 *
 * This module handles:
 * - Amending commits (with auto-rebase of children)
 * - Uncommitting (removing commits and preserving changes)
 * - Committing to a new branch
 */

import { log } from '@shared/logger'
import type { Configuration, RebaseIntent, RebaseTarget, Repo } from '@shared/types'
import { getAuthorIdentity, getGitAdapter, type GitAdapter } from '../adapters/git'
import {
  BranchUtils,
  RebaseIntentBuilder,
  RebaseStateMachine,
  StackAnalyzer,
  TrunkResolver
} from '../domain'
import { RepoModelService, SessionService } from '../services'
import { gitForgeService } from '../services/ForgeService'
import { createJobIdGenerator } from '../shared/job-id'
import { executeRebasePlan } from './RebaseExecutor'

export class CommitOperation {
  /**
   * Amends the current HEAD commit with optional new message.
   * Automatically rebases child branches to preserve stack integrity.
   */
  static async amend(repoPath: string, message?: string): Promise<void> {
    const config: Configuration = { repoPath }
    const git = getGitAdapter()

    const childrenToRebase = await this.findChildBranches(repoPath, config, git)

    await this.performAmend(repoPath, message, git)

    if (childrenToRebase.length > 0) {
      await this.rebaseChildren(repoPath, childrenToRebase, config, git)
    }
  }

  /**
   * Removes a commit and preserves its changes as staged.
   * Deletes branches pointing to the commit and navigates to an appropriate parent.
   */
  static async uncommit(repoPath: string, commitSha: string): Promise<void> {
    log.debug(`[CommitOperation.uncommit] Starting uncommit for ${commitSha}`)

    const git = getGitAdapter()
    const commitData = await git.readCommit(repoPath, commitSha)

    if (!commitData.parentSha) {
      throw new Error('Cannot uncommit a root commit')
    }

    const branchesToDelete = await this.findBranchesAtCommit(repoPath, commitSha, git)
    await this.closePullRequestsForBranches(repoPath, branchesToDelete)

    const branchesAtParent = await this.findBranchesAtCommit(repoPath, commitData.parentSha, git)
    const bestParentBranch = TrunkResolver.selectBestParentBranch(branchesAtParent)

    await this.softResetToParent(
      repoPath,
      commitSha,
      commitData.parentSha,
      branchesToDelete,
      bestParentBranch ?? null,
      git
    )

    await this.deleteBranches(repoPath, branchesToDelete, bestParentBranch ?? null, git)
  }

  /**
   * Creates a new branch and commits staged changes to it.
   */
  static async commitToNewBranch(
    repoPath: string,
    message: string,
    newBranchName?: string
  ): Promise<void> {
    const git = getGitAdapter()
    const currentBranch = await git.currentBranch(repoPath)

    if (!currentBranch) {
      throw new Error('Cannot commit from detached HEAD state')
    }

    const author = await getAuthorIdentity(repoPath)
    const branchName = newBranchName || BranchUtils.generateUserBranchName(author.name)

    await git.branch(repoPath, branchName, { checkout: true })

    await git.commit(repoPath, {
      message,
      author: { name: author.name, email: author.email },
      committer: { name: author.name, email: author.email }
    })
  }

  private static async findChildBranches(
    repoPath: string,
    config: Configuration,
    git: GitAdapter
  ): Promise<string[]> {
    try {
      const repo = await RepoModelService.buildRepoModel(config)
      const currentBranchName = await git.currentBranch(repoPath)

      if (!currentBranchName) return []

      const currentBranch = repo.branches.find((b) => b.ref === currentBranchName)
      if (!currentBranch?.headSha) return []

      const commitMap = new Map(repo.commits.map((c) => [c.sha, c]))
      const childBranches = StackAnalyzer.findDirectChildBranches(
        repo.branches,
        commitMap,
        currentBranch.headSha
      )

      return childBranches.map((b) => b.ref)
    } catch (err) {
      log.warn('Failed to identify children for auto-rebase:', err)
      return []
    }
  }

  private static async performAmend(
    repoPath: string,
    message: string | undefined,
    git: GitAdapter
  ): Promise<void> {
    const headCommitOid = await git.resolveRef(repoPath, 'HEAD')
    const headCommit = await git.readCommit(repoPath, headCommitOid)
    const currentIdentity = await getAuthorIdentity(repoPath)

    await git.commit(repoPath, {
      message: message || headCommit.message,
      author: {
        name: headCommit.author.name,
        email: headCommit.author.email
      },
      committer: {
        name: currentIdentity.name,
        email: currentIdentity.email
      },
      amend: true
    })
  }

  private static async rebaseChildren(
    repoPath: string,
    childrenToRebase: string[],
    config: Configuration,
    git: GitAdapter
  ): Promise<void> {
    try {
      const newRepo = await RepoModelService.buildRepoModel(config)
      const newHeadSha = await git.resolveRef(repoPath, 'HEAD')

      const targets = this.buildRebaseTargets(newRepo, childrenToRebase, newHeadSha)
      if (targets.length === 0) return

      const intent = this.createRebaseIntent(targets)
      const plan = this.createRebasePlan(newRepo, intent)

      await this.executeChildRebase(repoPath, plan, intent, git)
    } catch (err) {
      console.error('Failed to auto-rebase children after amend:', err)
    }
  }

  private static buildRebaseTargets(
    repo: Repo,
    childrenToRebase: string[],
    newHeadSha: string
  ): RebaseTarget[] {
    const targets: RebaseTarget[] = []

    for (const childName of childrenToRebase) {
      const childBranch = repo.branches.find((b) => b.ref === childName)
      if (!childBranch?.headSha) continue

      const intent = RebaseIntentBuilder.build(repo, childBranch.headSha, newHeadSha)
      if (intent) {
        targets.push(...intent.targets)
      }
    }

    return targets
  }

  private static createRebaseIntent(targets: RebaseTarget[]): RebaseIntent {
    return {
      id: `auto-rebase-${Date.now()}`,
      createdAtMs: Date.now(),
      targets
    }
  }

  private static createRebasePlan(repo: Repo, intent: RebaseIntent) {
    return RebaseStateMachine.createRebasePlan({
      repo,
      intent,
      generateJobId: createJobIdGenerator()
    })
  }

  private static async executeChildRebase(
    repoPath: string,
    plan: ReturnType<typeof RebaseStateMachine.createRebasePlan>,
    intent: RebaseIntent,
    git: GitAdapter
  ): Promise<void> {
    const currentBranchName = await git.currentBranch(repoPath)
    const storedSession = SessionService.createStoredSession(plan, currentBranchName || 'HEAD')
    await SessionService.rebaseSessionStore.createSession(repoPath, storedSession)

    const result = await executeRebasePlan(repoPath, { intent, state: plan.state }, git)

    if (result.status === 'completed' || result.status === 'error') {
      await SessionService.clearSession(repoPath)
    }

    if (result.status === 'error') {
      console.error('Auto-rebase failed:', result.message)
    }
  }

  private static async findBranchesAtCommit(
    repoPath: string,
    commitSha: string,
    git: GitAdapter
  ): Promise<string[]> {
    const branches = await git.listBranches(repoPath)
    const result: string[] = []

    for (const branch of branches) {
      const branchSha = await git.resolveRef(repoPath, branch)
      if (branchSha === commitSha) {
        result.push(branch)
      }
    }

    return result
  }

  private static async closePullRequestsForBranches(
    repoPath: string,
    branchesToDelete: string[]
  ): Promise<void> {
    try {
      const { state: forgeState } = await gitForgeService.getStateWithStatus(repoPath)

      for (const branch of branchesToDelete) {
        const pr = forgeState.pullRequests.find(
          (p) => p.headRefName === branch && p.state === 'open'
        )
        if (pr) {
          log.debug(`[CommitOperation] Closing associated PR #${pr.number} for branch ${branch}`)
          await gitForgeService.closePullRequest(repoPath, pr.number)
        }
      }
    } catch (e) {
      log.warn('[CommitOperation] Failed to handle GitHub PRs during uncommit:', e)
    }
  }

  private static async softResetToParent(
    repoPath: string,
    commitSha: string,
    parentSha: string,
    branchesToDelete: string[],
    bestParentBranch: string | null,
    git: GitAdapter
  ): Promise<void> {
    const currentBranch = await git.currentBranch(repoPath)
    const isDetached = !currentBranch

    let shouldUpdateHead = false
    if (isDetached) {
      const currentHead = await git.resolveRef(repoPath, 'HEAD')
      shouldUpdateHead = currentHead === commitSha
    } else if (currentBranch && branchesToDelete.includes(currentBranch)) {
      shouldUpdateHead = true
    }

    if (shouldUpdateHead) {
      await git.reset(repoPath, { mode: 'soft', ref: parentSha })

      if (bestParentBranch) {
        await git.checkout(repoPath, bestParentBranch)
      } else {
        await git.checkout(repoPath, parentSha, { detach: true })
      }
    }
  }

  private static async deleteBranches(
    repoPath: string,
    branches: string[],
    excludeBranch: string | null,
    git: GitAdapter
  ): Promise<void> {
    for (const branch of branches) {
      if (excludeBranch && branch === excludeBranch) continue
      await git.deleteBranch(repoPath, branch)
    }
  }
}
