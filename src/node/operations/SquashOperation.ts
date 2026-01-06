import type { SquashPreview, SquashResult } from '@shared/types'
import type { GitForgeState } from '@shared/types/git-forge'
import { getAuthorIdentity, getGitAdapter, supportsRebase, supportsRebaseAbort } from '../adapters/git'
import type { GitAdapter } from '../adapters/git'
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
    const parentHeadSha =
      validation.parentHeadSha ?? (await git.resolveRef(repoPath, parentBranch))

    const isEmpty =
      validation.commitDistance === 0 ||
      (await git.isDiffEmpty(repoPath, `${parentBranch}..${branchName}`))

    const parentCommit = await git.readCommit(repoPath, parentHeadSha)
    const targetCommit = await git.readCommit(repoPath, targetHeadSha)
    const pr = forgeStateResult.state.pullRequests.find(
      (p) => p.headRefName === branchName && p.state === 'open'
    )

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
      commitAuthor: targetCommit.author.name
    }
  }

  /**
   * Execute fold into parent.
   */
  static async execute(
    repoPath: string,
    branchName: string,
    options: { commitMessage?: string } = {}
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
    const parentHeadSha =
      validation.parentHeadSha ?? (await git.resolveRef(repoPath, parentBranch))
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

      await this.cleanupSquashedBranch(repoPath, branchName, forgeStateResult.state)

      // If we moved off the branch being deleted, stay on parent; otherwise leave as-is.
      if (originalBranch && originalBranch !== branchName) {
        await git.checkout(repoPath, originalBranch)
      }

      return { success: true, deletedBranch: branchName }
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

      await this.cleanupSquashedBranch(repoPath, branchName, forgeStateResult.state)
      await this.restoreBranch(repoPath, originalBranch, originalHead, parentBranch, git)

      return {
        success: true,
        modifiedBranches: pushResult.changedBranches,
        deletedBranch: branchName
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
  ): Promise<{ status: 'success' } | { status: 'conflict'; conflicts: string[] } | { status: 'error'; message: string }> {
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
  ): Promise<{ success: true; changedBranches: string[] } | { success: false; result: SquashResult }> {
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
    const pr = forgeState.pullRequests.find(
      (pull) => pull.headRefName === branch && pull.state === 'open'
    )
    if (pr) {
      await gitForgeService.closePullRequest(repoPath, pr.number)
    }

    await BranchOperation.cleanup(repoPath, branch)
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
