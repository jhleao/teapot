/**
 * PullRequestOperation - Orchestrates pull request operations
 *
 * This module handles:
 * - Creating PRs with automatic base branch detection
 * - Updating PRs (force push)
 * - Shipping PRs (merge via GitHub API)
 */

import { log } from '@shared/logger'
import type { Branch, Repo } from '@shared/types'
import { extractLocalBranchName } from '@shared/types'
import { findOpenPr, type MergeStrategy } from '@shared/types/git-forge'
import { isTrunk } from '@shared/types/repo'
import { getGitAdapter, supportsMerge, type GitAdapter } from '../adapters/git'
import { PrTargetResolver, ShipItNavigator } from '../domain'
import { RepoModelService } from '../services'
import { ExecutionContextService } from '../services/ExecutionContextService'
import { gitForgeService } from '../services/ForgeService'
import { getMergedBranchNames } from '../services/MergedBranchesService'
import { configStore } from '../store'

export type ShipItResult =
  | {
      success: true
      message: string
      needsRebase: boolean
      /** Whether we navigated to the target branch after merge */
      navigated: boolean
      /** If navigation was skipped, why */
      navigationSkippedReason?: 'dirty_worktree' | 'checkout_failed' | 'no_navigation_needed'
    }
  | {
      success: false
      error: string
    }

export class PullRequestOperation {
  /**
   * Creates a pull request for the given branch with automatic base branch detection.
   */
  static async create(repoPath: string, headBranch: string): Promise<void> {
    const git = getGitAdapter()
    const repo = await this.loadRepoWithRemotes(repoPath)

    const headBranchObj = this.findBranch(repo, headBranch)
    if (!headBranchObj?.headSha) {
      throw new Error(`Branch ${headBranch} not found`)
    }

    const title = this.getCommitMessage(repo, headBranchObj.headSha)
    const baseBranch = await this.findBaseBranch(
      repoPath,
      repo,
      headBranch,
      headBranchObj.headSha,
      git
    )

    await this.getOriginRemote(repoPath, git)

    const branchesToPush = this.determineBranchesToPush(repo, baseBranch, headBranch)
    await this.pushBranches(repoPath, branchesToPush, git)

    await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
  }

  /**
   * Updates an existing pull request by force pushing the branch.
   * Also updates the PR's base branch if it has changed (e.g., after a rebase).
   */
  static async update(repoPath: string, headBranch: string): Promise<void> {
    log.debug(`[PullRequestOperation.update] Updating PR for branch: ${headBranch}`)

    const git = getGitAdapter()

    // Force push the branch first
    await this.forcePushBranch(repoPath, headBranch, git)

    // Check if PR base needs updating
    const { state: forgeState } = await gitForgeService.getStateWithStatus(repoPath)
    const pr = findOpenPr(headBranch, forgeState.pullRequests)

    if (pr) {
      // Determine what the base should be based on current local state
      const repo = await this.loadRepoWithRemotes(repoPath)
      const headBranchObj = this.findBranch(repo, headBranch)

      if (headBranchObj?.headSha) {
        const newBase = await this.findBaseBranch(
          repoPath,
          repo,
          headBranch,
          headBranchObj.headSha,
          git
        )

        // Update PR base if it has changed
        if (newBase !== pr.baseRefName) {
          log.debug(
            `[PullRequestOperation.update] PR base changed: ${pr.baseRefName} -> ${newBase}`
          )
          await gitForgeService.updatePullRequestBase(repoPath, pr.number, newBase)
        }
      }
    }

    // Wait for GitHub to sync the head SHA
    const expectedSha = await git.resolveRef(repoPath, headBranch)
    await this.waitForPrSync(repoPath, headBranch, expectedSha)

    log.debug(`[PullRequestOperation.update] Successfully updated PR for branch ${headBranch}`)
  }

  /**
   * Ships a PR by merging it via GitHub API and handling post-merge navigation.
   * If the user was on the shipped branch, switches to the target branch.
   * If the active worktree is dirty, skips navigation to preserve uncommitted changes.
   */
  static async shipIt(
    repoPath: string,
    branchName: string,
    mergeStrategy: MergeStrategy
  ): Promise<ShipItResult> {
    const git = getGitAdapter()

    // Get forge state to find PR number and target branch
    const { state: forgeState } = await gitForgeService.getStateWithStatus(repoPath)

    // Validate using pure domain logic (defense in depth - UI should also validate)
    const validation = ShipItNavigator.validateCanShip(branchName, forgeState.pullRequests)
    if (!validation.canShip) {
      return { success: false, error: validation.reason }
    }

    // Find the PR (we know it exists because validation passed)
    const pr = findOpenPr(branchName, forgeState.pullRequests)!
    const targetBranch = pr.baseRefName

    // Get current branch before merging (for navigation decision)
    const currentBranch = await git.currentBranch(repoPath)

    // Check if active worktree is dirty before merging
    const isActiveWorktreeDirty = await ExecutionContextService.isActiveWorktreeDirty(repoPath)

    // Merge via GitHub API
    try {
      await gitForgeService.mergePullRequest(repoPath, pr.number, mergeStrategy)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('[PullRequestOperation.shipIt] Merge failed:', error)
      return { success: false, error: `Merge failed: ${errorMessage}` }
    }

    // Fetch to update remote refs
    await git.fetch(repoPath)

    // If worktree is dirty, skip navigation to preserve uncommitted changes
    if (isActiveWorktreeDirty) {
      log.info(
        '[PullRequestOperation.shipIt] Skipping navigation - worktree has uncommitted changes'
      )
      return {
        success: true,
        message: 'Shipped! Staying on current branch to preserve your changes.',
        needsRebase: false,
        navigated: false,
        navigationSkippedReason: 'dirty_worktree'
      }
    }

    // Determine navigation using pure domain logic
    const navigation = ShipItNavigator.determineNavigation({
      repoPath,
      shippedBranch: branchName,
      prTargetBranch: targetBranch,
      userCurrentBranch: currentBranch,
      wasDetached: currentBranch === null,
      hasChildren: false, // We block shipping branches with children, so always false here
      isWorkingTreeClean: true // We validated this before shipping
    })

    // Execute navigation if needed
    if (navigation.targetBranch) {
      try {
        await git.checkout(repoPath, navigation.targetBranch)

        // Try to fast-forward to match remote
        const remoteBranch = `origin/${navigation.targetBranch}`
        if (supportsMerge(git)) {
          try {
            await git.merge(repoPath, remoteBranch, { ffOnly: true })
          } catch {
            // Fast-forward failed - that's okay, user is still on target branch
          }
        }
      } catch (checkoutError) {
        // Checkout failed (e.g., target branch checked out in another worktree)
        // The merge succeeded, just can't switch branches
        log.warn('[PullRequestOperation.shipIt] Post-merge checkout failed:', checkoutError)
        return {
          success: true,
          message: 'Shipped! (Could not switch branches automatically)',
          needsRebase: navigation.needsRebase,
          navigated: false,
          navigationSkippedReason: 'checkout_failed'
        }
      }
    }

    return {
      success: true,
      message: navigation.message,
      needsRebase: navigation.needsRebase,
      navigated: navigation.targetBranch !== null,
      navigationSkippedReason: navigation.targetBranch === null ? 'no_navigation_needed' : undefined
    }
  }

  /**
   * Polls GitHub API until PR's headSha matches the expected SHA.
   * This handles GitHub's eventual consistency after force push.
   */
  private static async waitForPrSync(
    repoPath: string,
    branchName: string,
    expectedSha: string,
    maxAttempts = 10,
    delayMs = 500
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { state } = await gitForgeService.refreshWithStatus(repoPath)
      const pr = state.pullRequests.find((p) => p.headRefName === branchName)

      if (pr?.headSha === expectedSha) {
        log.debug(`[PullRequestOperation] PR synced after ${attempt} attempt(s)`)
        return
      }

      if (attempt < maxAttempts) {
        log.debug(
          `[PullRequestOperation] PR headSha mismatch, retrying (${attempt}/${maxAttempts})`
        )
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    // Timeout - log warning but don't fail (eventual consistency will catch up)
    log.warn(
      `[PullRequestOperation] PR sync timeout after ${maxAttempts} attempts, proceeding anyway`
    )
  }

  private static async loadRepoWithRemotes(repoPath: string): Promise<Repo> {
    return RepoModelService.buildRepoModel({ repoPath }, { loadRemotes: true })
  }

  private static findBranch(repo: Repo, branchName: string): Branch | undefined {
    return repo.branches.find((b) => b.ref === branchName)
  }

  private static getCommitMessage(repo: Repo, commitSha: string): string {
    const commit = repo.commits.find((c) => c.sha === commitSha)
    return commit?.message.split('\n')[0] || 'No title'
  }

  private static async findBaseBranch(
    repoPath: string,
    repo: Repo,
    headBranch: string,
    headCommitSha: string,
    git: GitAdapter
  ): Promise<string> {
    const trunkFallback = this.getTrunkBranchName(repo)
    const mergedBranchNames = await getMergedBranchNames(repoPath, repo, git)
    const candidateBaseBranch = PrTargetResolver.findBaseBranch(
      repo,
      headCommitSha,
      new Set(mergedBranchNames)
    )

    const { state: forgeState } = await gitForgeService.getStateWithStatus(repoPath)

    const resolvedBaseBranch = PrTargetResolver.findValidPrTarget(
      headBranch,
      candidateBaseBranch,
      forgeState.pullRequests,
      new Set(mergedBranchNames),
      trunkFallback ?? undefined
    )
    log.debug('[PullRequestOperation.findBaseBranch] Resolved base branch', {
      headBranch,
      candidateBaseBranch,
      resolvedBaseBranch,
      trunkFallback,
      mergedBranchCount: mergedBranchNames.length
    })
    return resolvedBaseBranch
  }

  private static getTrunkBranchName(repo: Repo): string | null {
    const trunk =
      repo.branches.find((b) => b.isTrunk && !b.isRemote) ?? repo.branches.find((b) => b.isTrunk)
    if (!trunk) return null
    const localName = trunk.isRemote ? extractLocalBranchName(trunk.ref) : trunk.ref
    return isTrunk(localName) ? localName : null
  }

  private static async getOriginRemote(repoPath: string, git: GitAdapter): Promise<string> {
    const remotes = await git.listRemotes(repoPath)
    const origin = remotes.find((r) => r.name === 'origin')

    if (!origin) {
      throw new Error('No origin remote configured')
    }

    return origin.url
  }

  private static async pushBranches(
    repoPath: string,
    branches: string[],
    git: GitAdapter
  ): Promise<void> {
    const pat = configStore.getGithubPat()
    const credentials = pat ? { username: pat, password: '' } : undefined

    for (const branch of branches) {
      try {
        await git.push(repoPath, {
          remote: 'origin',
          ref: branch,
          setUpstream: true,
          credentials
        })
      } catch (error) {
        log.error(`Failed to push branch ${branch} before creating PR:`, error)
        throw new Error(
          `Failed to push branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  private static determineBranchesToPush(
    repo: Repo,
    baseBranch: string,
    headBranch: string
  ): string[] {
    const baseBranchExistsOnRemote =
      isTrunk(baseBranch) ||
      repo.branches.some((b) => b.isRemote && b.ref === `origin/${baseBranch}`)

    return baseBranchExistsOnRemote ? [headBranch] : [baseBranch, headBranch]
  }

  private static async forcePushBranch(
    repoPath: string,
    branch: string,
    git: GitAdapter
  ): Promise<void> {
    try {
      await git.push(repoPath, {
        remote: 'origin',
        ref: branch,
        force: true
      })
    } catch (error) {
      log.error(`Failed to push branch ${branch}:`, error)
      throw new Error(
        `Failed to push branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
