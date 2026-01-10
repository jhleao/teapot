import type { BranchChoice, SquashPreview, SquashResult } from '@shared/types'
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

export class SquashOperation {
  /**
   * Preview fold into parent ("squash into parent") for confirmation UI.
   */
  static async preview(repoPath: string, branchName: string): Promise<SquashPreview> {
    const git = getGitAdapter()

    const [repo, forgeStateResult] = await Promise.all([
      RepoModelService.buildRepoModel({ repoPath }),
      gitForgeService.getStateWithStatus(repoPath)
    ])

    const validation = SquashValidator.validate(repo, branchName, forgeStateResult.state)
    if (!validation.canSquash) {
      return {
        canSquash: false,
        error: validation.error,
        errorDetail: validation.errorDetail
      }
    }

    const parentBranch = validation.parentBranch!
    const targetHeadSha = validation.targetHeadSha ?? (await git.resolveRef(repoPath, branchName))
    const parentHeadSha = validation.parentHeadSha ?? (await git.resolveRef(repoPath, parentBranch))

    const isEmpty =
      validation.commitDistance === 0 ||
      (await git.isDiffEmpty(repoPath, `${parentBranch}..${branchName}`))

    const parentCommit = await git.readCommit(repoPath, parentHeadSha)
    const targetCommit = await git.readCommit(repoPath, targetHeadSha)
    const pr = findOpenPr(branchName, forgeStateResult.state.pullRequests)

    // After squash, both branches will point to the same commit - this is a collision
    // The child branch (branchName) is being squashed into parent, so user must choose
    const branchCollision = {
      existingBranch: parentBranch,
      childBranch: branchName
    }

    return {
      canSquash: true,
      targetBranch: branchName,
      parentBranch,
      descendantBranches: validation.descendantBranches,
      isEmpty,
      hasPr: Boolean(pr),
      prNumber: pr?.number,
      parentCommitMessage: parentCommit.message,
      commitMessage: targetCommit.message,
      commitAuthor: targetCommit.author.name,
      branchCollision
    }
  }

  /**
   * Execute fold into parent.
   */
  static async execute(
    repoPath: string,
    branchName: string,
    options: { commitMessage?: string; branchChoice?: BranchChoice } = {}
  ): Promise<SquashResult> {
    const git = getGitAdapter()

    const [repo, forgeStateResult] = await Promise.all([
      RepoModelService.buildRepoModel({ repoPath }),
      gitForgeService.getStateWithStatus(repoPath)
    ])

    const validation = SquashValidator.validate(repo, branchName, forgeStateResult.state)
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
        error: 'dirty_tree',
        errorDetail: 'Rebase is already in progress'
      }
    }

    const workingTree = await git.getWorkingTreeStatus(repoPath)
    if (workingTree.allChangedFiles.length > 0 || workingTree.isRebasing) {
      return { success: false, error: 'dirty_tree' }
    }

    const parentBranch = validation.parentBranch!
    const descendants = validation.descendantBranches
    const directChild = descendants[0]
    const parentHeadSha = validation.parentHeadSha ?? (await git.resolveRef(repoPath, parentBranch))
    const targetHeadSha = validation.targetHeadSha ?? (await git.resolveRef(repoPath, branchName))

    const isEmpty =
      validation.commitDistance === 0 ||
      (await git.isDiffEmpty(repoPath, `${parentBranch}..${branchName}`))

    const originalBranch = await git.currentBranch(repoPath)
    const originalHead = await git.resolveRef(repoPath, 'HEAD')

    const branchesToTrack = [parentBranch, ...descendants]
    const originalShas = await this.captureBranchShas(repoPath, branchesToTrack, git)

    // Fast path: nothing to apply and no descendants to rebase.
    if (isEmpty && descendants.length === 0) {
      // Ensure we're not on the branch being deleted.
      if (originalBranch === branchName) {
        await git.checkout(repoPath, parentBranch)
      }

      const branchResult = await this.handleBranchAfterSquash(
        repoPath,
        parentBranch,
        branchName,
        options.branchChoice,
        forgeStateResult.state,
        git
      )

      // If we moved off the branch being deleted, stay on parent; otherwise leave as-is.
      if (originalBranch && originalBranch !== branchName && !branchResult.deletedBranch?.includes(originalBranch)) {
        await git.checkout(repoPath, originalBranch)
      }

      return {
        success: true,
        deletedBranch: branchResult.deletedBranch,
        preservedBranch: branchResult.preservedBranch
      }
    }

    try {
      await git.checkout(repoPath, parentBranch)

      let newParentSha = parentHeadSha

      if (!isEmpty) {
        const patch = await git.formatPatch(repoPath, `${parentBranch}..${branchName}`)
        const applyResult = await git.applyPatch(repoPath, patch)

        if (!applyResult.success) {
          return { success: false, error: 'conflict', conflicts: applyResult.conflicts }
        }

        await git.add(repoPath, ['.'])

        const targetCommit = await git.readCommit(repoPath, targetHeadSha)
        const currentIdentity = await getAuthorIdentity(repoPath)
        const commitMessage = options.commitMessage ?? targetCommit.message

        await git.commit(repoPath, {
          message: commitMessage,
          author: {
            name: targetCommit.author.name,
            email: targetCommit.author.email
          },
          committer: {
            name: currentIdentity.name,
            email: currentIdentity.email
          },
          amend: true
        })

        newParentSha = await git.resolveRef(repoPath, parentBranch)
      }

      const rebaseResult = await this.rebaseDescendants(
        repoPath,
        parentBranch,
        directChild,
        descendants,
        originalShas,
        newParentSha,
        git
      )

      if (rebaseResult.status === 'conflict') {
        await this.rollbackBranches(
          repoPath,
          branchesToTrack,
          originalShas,
          git,
          originalBranch,
          originalHead,
          parentBranch
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
          originalHead,
          parentBranch
        )
        return { success: false, error: 'ancestry_mismatch', errorDetail: rebaseResult.message }
      }

      const pushResult = await this.pushUpdatedBranches(
        repoPath,
        parentBranch,
        descendants,
        originalShas,
        git
      )

      if (!pushResult.success) {
        return pushResult.result
      }

      const branchResult = await this.handleBranchAfterSquash(
        repoPath,
        parentBranch,
        branchName,
        options.branchChoice,
        forgeStateResult.state,
        git
      )

      await this.restoreBranch(repoPath, originalBranch, originalHead, parentBranch, git)

      return {
        success: true,
        modifiedBranches: pushResult.changedBranches,
        deletedBranch: branchResult.deletedBranch,
        preservedBranch: branchResult.preservedBranch
      }
    } catch (error) {
      await this.rollbackBranches(
        repoPath,
        branchesToTrack,
        originalShas,
        git,
        originalBranch,
        originalHead,
        parentBranch
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
      result.set(branch, await git.resolveRef(repoPath, branch))
    }
    return result
  }

  private static async rebaseDescendants(
    repoPath: string,
    parentBranch: string,
    directChild: string | undefined,
    allDescendants: string[],
    originalShas: Map<string, string>,
    newParentSha: string,
    git: GitAdapter
  ): Promise<
    | { status: 'success' }
    | { status: 'conflict'; conflicts: string[] }
    | { status: 'error'; message: string }
  > {
    if (!directChild || allDescendants.length === 0) {
      return { status: 'success' }
    }

    if (!supportsRebase(git)) {
      return { status: 'error', message: 'Git adapter does not support rebase' }
    }

    let upstreamSha = originalShas.get(parentBranch) ?? newParentSha
    let ontoSha = newParentSha

    for (const branch of allDescendants) {
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

      upstreamSha = originalShas.get(branch) ?? (await git.resolveRef(repoPath, branch))
      ontoSha = await git.resolveRef(repoPath, branch)
    }

    await git.checkout(repoPath, parentBranch)
    return { status: 'success' }
  }

  private static async rollbackBranches(
    repoPath: string,
    branches: string[],
    originalShas: Map<string, string>,
    git: GitAdapter,
    originalBranch: string | null,
    originalHeadSha: string,
    fallbackBranch: string
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
      await git.checkout(repoPath, fallbackBranch)
    }
  }

  private static async pushUpdatedBranches(
    repoPath: string,
    parentBranch: string,
    descendants: string[],
    originalShas: Map<string, string>,
    git: GitAdapter
  ): Promise<
    { success: true; changedBranches: string[] } | { success: false; result: SquashResult }
  > {
    const branchesToPush = [parentBranch, ...descendants]
    const changedBranches: string[] = []

    try {
      for (const branch of branchesToPush) {
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

  private static async cleanupSquashedBranch(
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

  /**
   * Handle branch preservation/deletion after squash based on user's choice.
   *
   * @param parentBranch - The parent branch (stays on result commit)
   * @param childBranch - The child branch being squashed
   * @param branchChoice - User's choice: 'parent' | 'child' | 'both' | custom name
   *   - 'parent': Keep parent branch, delete child branch (and close its PR)
   *   - 'child': Keep child branch (move to result), delete parent branch (and close its PR)
   *   - 'both': Keep both branches pointing to the same commit
   *   - custom string: Rename child to custom name, delete original child (close its PR)
   */
  private static async handleBranchAfterSquash(
    repoPath: string,
    parentBranch: string,
    childBranch: string,
    branchChoice: BranchChoice | undefined,
    forgeState: GitForgeState,
    git: GitAdapter
  ): Promise<{ deletedBranch?: string; preservedBranch?: string }> {
    // Default to 'parent' if no choice specified (backwards compatibility)
    const choice = branchChoice ?? 'parent'

    if (choice === 'parent') {
      // Keep parent branch, delete child branch and close its PR
      await this.cleanupSquashedBranch(repoPath, childBranch, forgeState)
      return { deletedBranch: childBranch, preservedBranch: parentBranch }
    }

    if (choice === 'child') {
      // Move child branch to result commit (which is now where parent points)
      // Delete parent branch and close its PR
      const resultSha = await git.resolveRef(repoPath, parentBranch)

      // Update child branch to point to the result commit by deleting and recreating
      await git.deleteBranch(repoPath, childBranch)
      await git.branch(repoPath, childBranch, { startPoint: resultSha })

      // Close parent's PR if it has one
      const parentPr = findOpenPr(parentBranch, forgeState.pullRequests)
      if (parentPr) {
        await gitForgeService.closePullRequest(repoPath, parentPr.number)
      }

      // Delete parent branch
      await BranchOperation.cleanup(repoPath, parentBranch)

      return { deletedBranch: parentBranch, preservedBranch: childBranch }
    }

    if (choice === 'both') {
      // Keep both branches pointing to the same commit
      // Child branch needs to be moved to the result commit
      const resultSha = await git.resolveRef(repoPath, parentBranch)

      // Update child branch by deleting and recreating at new position
      await git.deleteBranch(repoPath, childBranch)
      await git.branch(repoPath, childBranch, { startPoint: resultSha })

      // No branches deleted, no PRs closed
      return { preservedBranch: parentBranch }
    }

    // Custom name: create new branch with custom name, delete child branch
    const customName = choice
    const resultSha = await git.resolveRef(repoPath, parentBranch)

    // Create new branch with the custom name at the result commit
    await git.branch(repoPath, customName, { startPoint: resultSha })

    // Push the new branch to remote
    await git.push(repoPath, {
      remote: 'origin',
      ref: customName,
      setUpstream: true
    })

    // Delete the original child branch (and close its PR)
    await this.cleanupSquashedBranch(repoPath, childBranch, forgeState)

    return { deletedBranch: childBranch, preservedBranch: customName }
  }

  private static async restoreBranch(
    repoPath: string,
    originalBranch: string | null,
    originalHeadSha: string,
    parentBranch: string,
    git: GitAdapter
  ): Promise<void> {
    if (originalBranch && originalBranch !== parentBranch) {
      try {
        await git.checkout(repoPath, originalBranch)
        return
      } catch {
        // fall through to detach
      }
    }

    try {
      await git.checkout(repoPath, originalHeadSha, { detach: true })
    } catch {
      await git.checkout(repoPath, parentBranch)
    }
  }
}
