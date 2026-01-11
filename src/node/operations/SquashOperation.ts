import type { BranchCollisionResolution, SquashPreview, SquashResult } from '@shared/types'
import { findOpenPr, type GitForgeState } from '@shared/types/git-forge'
import type { GitAdapter } from '../adapters/git'
import {
  getAuthorIdentity,
  getGitAdapter,
  supportsRebase,
  supportsRebaseAbort
} from '../adapters/git'
import { SquashValidator } from '../domain'
import { RepoModelService, SessionService } from '../services'
import { gitForgeService } from '../services/ForgeService'
import { BranchOperation } from './BranchOperation'

export type SquashOptions = {
  commitMessage?: string
  branchResolution?: BranchCollisionResolution
}

export class SquashOperation {
  /**
   * Preview squash into parent for confirmation UI.
   * Works at the commit level, not the branch level.
   */
  static async preview(repoPath: string, commitSha: string): Promise<SquashPreview> {
    const git = getGitAdapter()

    const [repo, forgeStateResult] = await Promise.all([
      RepoModelService.buildRepoModel({ repoPath }),
      gitForgeService.getStateWithStatus(repoPath)
    ])

    // Check if operating on current branch (for dirty worktree validation)
    const currentCommitSha = repo.workingTreeStatus.currentCommitSha
    const isCurrentBranch = currentCommitSha === commitSha

    const validation = SquashValidator.validate(repo, commitSha, forgeStateResult.state, {
      isCurrentBranch
    })

    if (!validation.canSquash) {
      return {
        canSquash: false,
        error: validation.error,
        errorDetail: validation.errorDetail
      }
    }

    const targetCommitSha = validation.targetCommitSha!
    const parentCommitSha = validation.parentCommitSha!

    const isEmpty = await git.isDiffEmpty(repoPath, `${parentCommitSha}..${targetCommitSha}`)

    const parentCommit = await git.readCommit(repoPath, parentCommitSha)
    const targetCommit = await git.readCommit(repoPath, targetCommitSha)

    const targetBranch = validation.targetBranch
    const parentBranch = validation.parentBranch

    // Check for PRs on both branches
    const targetPr = targetBranch
      ? findOpenPr(targetBranch, forgeStateResult.state.pullRequests)
      : null
    const parentPr = parentBranch
      ? findOpenPr(parentBranch, forgeStateResult.state.pullRequests)
      : null

    // Branch collision occurs when both commits have branches
    const hasBranchCollision = Boolean(targetBranch && parentBranch)

    return {
      canSquash: true,
      targetCommitSha,
      parentCommitSha,
      targetBranch: targetBranch ?? null,
      parentBranch: parentBranch ?? null,
      descendantBranches: validation.descendantBranches,
      isEmpty,
      targetHasPr: Boolean(targetPr),
      targetPrNumber: targetPr?.number,
      parentHasPr: Boolean(parentPr),
      parentPrNumber: parentPr?.number,
      parentCommitMessage: parentCommit.message,
      commitMessage: targetCommit.message,
      commitAuthor: targetCommit.author.name,
      hasBranchCollision
    }
  }

  /**
   * Execute squash of a commit into its parent.
   */
  static async execute(
    repoPath: string,
    commitSha: string,
    options: SquashOptions = {}
  ): Promise<SquashResult> {
    const git = getGitAdapter()

    const [repo, forgeStateResult] = await Promise.all([
      RepoModelService.buildRepoModel({ repoPath }),
      gitForgeService.getStateWithStatus(repoPath)
    ])

    // Check if operating on current branch
    const currentCommitSha = repo.workingTreeStatus.currentCommitSha
    const isCurrentBranch = currentCommitSha === commitSha

    const validation = SquashValidator.validate(repo, commitSha, forgeStateResult.state, {
      isCurrentBranch
    })

    if (!validation.canSquash) {
      return {
        success: false,
        error: validation.error,
        errorDetail: validation.errorDetail
      }
    }

    // Block if another rebase session is already active
    if (await SessionService.getSession(repoPath)) {
      return {
        success: false,
        error: 'rebase_in_progress',
        errorDetail: 'Rebase is already in progress'
      }
    }

    const targetCommitSha = validation.targetCommitSha!
    const parentCommitSha = validation.parentCommitSha!
    const targetBranch = validation.targetBranch
    const parentBranch = validation.parentBranch
    const descendants = validation.descendantBranches

    const isEmpty = await git.isDiffEmpty(repoPath, `${parentCommitSha}..${targetCommitSha}`)

    const originalBranch = await git.currentBranch(repoPath)
    const originalHead = await git.resolveRef(repoPath, 'HEAD')

    // Track branches that need to be restored on rollback
    const branchesToTrack = [...(parentBranch ? [parentBranch] : []), ...descendants]
    if (targetBranch && !branchesToTrack.includes(targetBranch)) {
      branchesToTrack.push(targetBranch)
    }
    const originalShas = await this.captureBranchShas(repoPath, branchesToTrack, git)

    try {
      // Step 1: Create the squashed commit
      let newCommitSha: string

      if (isEmpty) {
        // Empty squash - just use parent commit
        newCommitSha = parentCommitSha
      } else {
        // Perform soft reset to parent, then recommit with combined changes
        // We need to work from a temporary branch to avoid affecting current checkout
        const tempBranchName = `teapot-squash-temp-${Date.now()}`

        // Create temp branch at parent commit
        await git.branch(repoPath, tempBranchName, { startPoint: parentCommitSha })
        await git.checkout(repoPath, tempBranchName)

        // Apply the changes from target commit
        const patch = await git.formatPatch(repoPath, `${parentCommitSha}..${targetCommitSha}`)
        const applyResult = await git.applyPatch(repoPath, patch)

        if (!applyResult.success) {
          // Cleanup temp branch and restore
          await git.checkout(repoPath, originalBranch ?? originalHead, { detach: !originalBranch })
          await git.deleteBranch(repoPath, tempBranchName)
          return { success: false, error: 'conflict', conflicts: applyResult.conflicts }
        }

        await git.add(repoPath, ['.'])

        // Read both commits to create combined message
        const parentCommit = await git.readCommit(repoPath, parentCommitSha)
        const targetCommit = await git.readCommit(repoPath, targetCommitSha)
        const currentIdentity = await getAuthorIdentity(repoPath)

        // Use provided message or combine parent + target messages
        const finalMessage =
          options.commitMessage ?? `${parentCommit.message}\n\n---\n\n${targetCommit.message}`

        // Amend the parent commit with the combined changes
        await git.commit(repoPath, {
          message: finalMessage,
          author: {
            name: parentCommit.author.name,
            email: parentCommit.author.email
          },
          committer: {
            name: currentIdentity.name,
            email: currentIdentity.email
          },
          amend: true
        })

        newCommitSha = await git.resolveRef(repoPath, tempBranchName)

        // Step 2: Move parent branch to new commit (if exists)
        if (parentBranch) {
          await git.checkout(repoPath, parentBranch)
          await git.reset(repoPath, { mode: 'hard', ref: newCommitSha })
        }

        // Cleanup temp branch
        await git.deleteBranch(repoPath, tempBranchName)
      }

      // Step 3: Handle branch resolution
      let deletedBranch: string | undefined
      const deletedBranches: string[] = []
      const modifiedBranches: string[] = []

      // Determine which branch to use as result (for checkout logic later)
      let resultBranch: string | undefined

      if (targetBranch && parentBranch) {
        // Branch collision case
        const resolution = options.branchResolution ?? { type: 'keep_parent' }

        switch (resolution.type) {
          case 'keep_parent':
            // Delete target branch, keep parent at new commit
            // First checkout parent so we're not on the branch we're deleting
            await git.checkout(repoPath, parentBranch)
            await this.cleanupBranch(repoPath, targetBranch, forgeStateResult.state)
            deletedBranch = targetBranch
            deletedBranches.push(targetBranch)
            modifiedBranches.push(parentBranch)
            resultBranch = parentBranch
            break

          case 'keep_child':
            // Delete parent branch, move target to new commit
            // First checkout target so we're not on the branch we're deleting
            await git.checkout(repoPath, targetBranch)
            await git.reset(repoPath, { mode: 'hard', ref: newCommitSha })
            await this.cleanupBranch(repoPath, parentBranch, forgeStateResult.state)
            deletedBranch = parentBranch
            deletedBranches.push(parentBranch)
            modifiedBranches.push(targetBranch)
            resultBranch = targetBranch
            break

          case 'keep_both':
            // Both branches point to new commit
            await git.checkout(repoPath, targetBranch)
            await git.reset(repoPath, { mode: 'hard', ref: newCommitSha })
            modifiedBranches.push(parentBranch, targetBranch)
            resultBranch = parentBranch
            break

          case 'new_name':
            // Delete both, create new branch at new commit first
            await git.branch(repoPath, resolution.name, { startPoint: newCommitSha })
            // Checkout new branch before deleting old ones
            await git.checkout(repoPath, resolution.name)
            await this.cleanupBranch(repoPath, targetBranch, forgeStateResult.state)
            await this.cleanupBranch(repoPath, parentBranch, forgeStateResult.state)
            deletedBranch = `${targetBranch}, ${parentBranch}`
            deletedBranches.push(targetBranch, parentBranch)
            modifiedBranches.push(resolution.name)
            resultBranch = resolution.name
            break
        }
      } else if (targetBranch) {
        // Only target has a branch - move it to new commit
        await git.checkout(repoPath, targetBranch)
        await git.reset(repoPath, { mode: 'hard', ref: newCommitSha })
        modifiedBranches.push(targetBranch)
        resultBranch = targetBranch
      } else if (parentBranch) {
        // Only parent has a branch - it's already at new commit
        modifiedBranches.push(parentBranch)
        resultBranch = parentBranch
      }

      // Step 4: Rebase descendants onto new commit
      if (descendants.length > 0) {
        const rebaseResult = await this.rebaseDescendants(
          repoPath,
          newCommitSha,
          targetCommitSha,
          descendants,
          originalShas,
          git
        )

        if (rebaseResult.status === 'conflict') {
          await this.rollbackBranches(
            repoPath,
            branchesToTrack,
            originalShas,
            git,
            originalBranch,
            originalHead
          )
          return { success: false, error: 'descendant_conflict', conflicts: rebaseResult.conflicts }
        }

        if (rebaseResult.status === 'error') {
          await this.rollbackBranches(
            repoPath,
            branchesToTrack,
            originalShas,
            git,
            originalBranch,
            originalHead
          )
          return { success: false, error: 'ancestry_mismatch', errorDetail: rebaseResult.message }
        }

        modifiedBranches.push(...descendants)
      }

      // Step 5: Push all modified branches
      const pushResult = await this.pushUpdatedBranches(
        repoPath,
        modifiedBranches,
        originalShas,
        git
      )

      if (!pushResult.success) {
        return pushResult.result
      }

      // Step 6: Handle checkout after squash
      // Only checkout the result if user was on one of the involved branches
      const involvedBranches = [targetBranch, parentBranch, ...descendants].filter(Boolean)
      const wasOnInvolvedBranch = originalBranch && involvedBranches.includes(originalBranch)

      if (wasOnInvolvedBranch) {
        // User was on an involved branch - checkout the result
        if (resultBranch) {
          await git.checkout(repoPath, resultBranch)
        }
      } else {
        // User was not on an involved branch - restore original state
        await this.restoreBranch(repoPath, originalBranch, originalHead, deletedBranches, git)
      }

      return {
        success: true,
        modifiedBranches: pushResult.changedBranches,
        deletedBranch
      }
    } catch (error) {
      await this.rollbackBranches(
        repoPath,
        branchesToTrack,
        originalShas,
        git,
        originalBranch,
        originalHead
      )
      throw error
    }
  }

  private static async captureBranchShas(
    repoPath: string,
    branches: string[],
    git: GitAdapter
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    for (const branch of branches) {
      try {
        result.set(branch, await git.resolveRef(repoPath, branch))
      } catch {
        // Branch might not exist yet, skip it
      }
    }
    return result
  }

  private static async rebaseDescendants(
    repoPath: string,
    newBaseSha: string,
    oldBaseSha: string,
    descendants: string[],
    originalShas: Map<string, string>,
    git: GitAdapter
  ): Promise<
    | { status: 'success' }
    | { status: 'conflict'; conflicts: string[] }
    | { status: 'error'; message: string }
  > {
    if (descendants.length === 0) {
      return { status: 'success' }
    }

    if (!supportsRebase(git)) {
      return { status: 'error', message: 'Git adapter does not support rebase' }
    }

    let ontoSha = newBaseSha
    let upstreamSha = oldBaseSha

    for (const branch of descendants) {
      await git.checkout(repoPath, branch)

      const rebaseResult = await git.rebase(repoPath, {
        onto: ontoSha,
        from: upstreamSha,
        to: branch
      })

      if (!rebaseResult.success) {
        if (supportsRebaseAbort(git)) {
          await git.rebaseAbort?.(repoPath)
        }
        return { status: 'conflict', conflicts: rebaseResult.conflicts }
      }

      // Next descendant rebases onto this branch's new position
      upstreamSha = originalShas.get(branch) ?? (await git.resolveRef(repoPath, branch))
      ontoSha = await git.resolveRef(repoPath, branch)
    }

    return { status: 'success' }
  }

  private static async rollbackBranches(
    repoPath: string,
    branches: string[],
    originalShas: Map<string, string>,
    git: GitAdapter,
    originalBranch: string | null,
    originalHeadSha: string
  ): Promise<void> {
    for (const branch of branches) {
      const targetSha = originalShas.get(branch)
      if (!targetSha) continue
      try {
        await git.checkout(repoPath, branch)
        await git.reset(repoPath, { mode: 'hard', ref: targetSha })
      } catch {
        // Best-effort rollback; ignore failures to avoid masking original error
      }
    }

    if (originalBranch) {
      try {
        await git.checkout(repoPath, originalBranch)
        return
      } catch {
        // ignore
      }
    }

    try {
      await git.checkout(repoPath, originalHeadSha, { detach: true })
    } catch {
      // Last resort - stay wherever we are
    }
  }

  private static async pushUpdatedBranches(
    repoPath: string,
    branches: string[],
    originalShas: Map<string, string>,
    git: GitAdapter
  ): Promise<
    { success: true; changedBranches: string[] } | { success: false; result: SquashResult }
  > {
    const changedBranches: string[] = []

    try {
      for (const branch of branches) {
        const originalSha = originalShas.get(branch)
        const newSha = await git.resolveRef(repoPath, branch)

        if (originalSha === newSha) {
          continue
        }

        await git.push(repoPath, {
          remote: 'origin',
          ref: branch,
          forceWithLease: originalSha ? { ref: branch, expect: originalSha } : true
        })

        changedBranches.push(branch)
      }

      return { success: true, changedBranches }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        result: {
          success: false,
          error: 'push_failed',
          errorDetail: errorMessage,
          localSuccess: true,
          modifiedBranches: changedBranches
        }
      }
    }
  }

  private static async cleanupBranch(
    repoPath: string,
    branch: string,
    forgeState: GitForgeState
  ): Promise<void> {
    const pr = findOpenPr(branch, forgeState.pullRequests)
    if (pr) {
      await gitForgeService.closePullRequest(repoPath, pr.number)
    }

    await BranchOperation.cleanup(repoPath, branch)
  }

  private static async restoreBranch(
    repoPath: string,
    originalBranch: string | null,
    originalHeadSha: string,
    deletedBranches: string[],
    git: GitAdapter
  ): Promise<void> {
    // If original branch was deleted, don't try to restore to it
    if (originalBranch && !deletedBranches.includes(originalBranch)) {
      try {
        await git.checkout(repoPath, originalBranch)
        return
      } catch {
        // fall through
      }
    }

    // Try to checkout the original HEAD sha (detached)
    try {
      await git.checkout(repoPath, originalHeadSha, { detach: true })
    } catch {
      // Stay wherever we are - we're likely already on a valid branch
    }
  }
}
