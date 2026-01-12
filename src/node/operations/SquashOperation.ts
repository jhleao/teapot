import { log } from '@shared/logger'
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
import { RepoModelService, SessionService, TransactionService } from '../services'
import {
  ExecutionContextService,
  WorktreeCreationError,
  type ExecutionContext
} from '../services/ExecutionContextService'
import { gitForgeService } from '../services/ForgeService'
import { configStore } from '../store'
import { BranchOperation } from './BranchOperation'
import { WorktreeOperation } from './WorktreeOperation'

/**
 * Result of acquiring an execution context for squash.
 */
type SquashContextResult =
  | { success: true; context: ExecutionContext }
  | { success: false; error: SquashResult }

/**
 * Phases of the squash operation for progress tracking.
 */
export type SquashPhase =
  | 'validating'
  | 'acquiring-context'
  | 'applying-patch'
  | 'rebasing-descendants'
  | 'handling-branches'
  | 'cleanup'

/**
 * Progress callback details for descendant rebase.
 */
export interface SquashRebaseProgress {
  branch: string
  index: number
  total: number
}

/**
 * Options for SquashOperation.execute() including progress callbacks.
 */
export interface SquashExecuteOptions {
  commitMessage?: string
  branchChoice?: BranchChoice
  /** Called when a phase starts */
  onPhaseStart?: (phase: SquashPhase) => void
  /** Called when a phase completes */
  onPhaseComplete?: (phase: SquashPhase) => void
  /** Called when starting to rebase a descendant branch */
  onRebaseStart?: (progress: SquashRebaseProgress) => void
  /** Called when a descendant branch rebase completes */
  onRebaseComplete?: (progress: SquashRebaseProgress) => void
  /** Called when a conflict is detected */
  onConflict?: (branch: string, conflicts: string[]) => void
}

/**
 * Error thrown when branch positions change unexpectedly during operation.
 */
export class BranchPositionError extends Error {
  constructor(
    public readonly branch: string,
    public readonly expectedSha: string,
    public readonly actualSha: string
  ) {
    super(
      `Branch ${branch} was modified externally during squash. ` +
        `Expected ${expectedSha.slice(0, 8)}, got ${actualSha.slice(0, 8)}.`
    )
    this.name = 'BranchPositionError'
  }
}

/**
 * Verify that a branch is still at the expected position.
 * Throws BranchPositionError if the branch has moved.
 */
async function verifyBranchPosition(
  repoPath: string,
  branch: string,
  expectedSha: string,
  git: GitAdapter
): Promise<void> {
  const actualSha = await git.resolveRef(repoPath, branch)
  if (actualSha !== expectedSha) {
    throw new BranchPositionError(branch, expectedSha, actualSha)
  }
}

/**
 * Acquire an execution context for the squash operation.
 * Uses a temporary worktree to keep the user's working directory untouched.
 */
async function acquireSquashContext(
  repoPath: string,
  targetBranch: string
): Promise<SquashContextResult> {
  try {
    const context = await ExecutionContextService.acquire(repoPath, {
      operation: 'squash',
      targetBranch
    })
    return { success: true, context }
  } catch (error) {
    if (error instanceof WorktreeCreationError) {
      return {
        success: false,
        error: {
          success: false,
          error: 'dirty_tree',
          errorDetail:
            'Could not create temporary worktree for squash. Please commit or stash your changes and try again.'
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: {
        success: false,
        error: 'ancestry_mismatch',
        errorDetail: `Failed to acquire execution context: ${message}`
      }
    }
  }
}

/**
 * Safely release the execution context, logging any errors.
 */
async function safeReleaseContext(repoPath: string, context: ExecutionContext): Promise<void> {
  try {
    await ExecutionContextService.release(context)
  } catch (error) {
    log.warn('[SquashOperation] Context cleanup failed (non-fatal):', {
      repoPath,
      executionPath: context.executionPath,
      error
    })
  }
}

export class SquashOperation {
  /**
   * Preview squash into parent for confirmation UI.
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

    // Check for worktree conflicts - branches checked out in other worktrees
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath
    const worktreeValidation = SquashValidator.validateNoWorktreeConflicts(
      branchName,
      parentBranch,
      validation.descendantBranches,
      repo.worktrees,
      activeWorktreePath
    )

    if (!worktreeValidation.valid) {
      // Only block if there are dirty worktrees - clean ones can be auto-detached
      const { dirty } = SquashValidator.partitionWorktreeConflicts(worktreeValidation.conflicts)
      if (dirty.length > 0) {
        return {
          canSquash: false,
          error: 'worktree_conflict',
          errorDetail: SquashValidator.formatWorktreeConflictMessage(dirty),
          worktreeConflicts: dirty
        }
      }
      // Clean worktrees will be auto-detached during execute - include info for UI
    }
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
   * Execute squash into parent.
   */
  static async execute(
    repoPath: string,
    branchName: string,
    options: SquashExecuteOptions = {}
  ): Promise<SquashResult> {
    const git = getGitAdapter()

    // Phase: validating
    options.onPhaseStart?.('validating')

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

    // Note: We don't block dirty trees here anymore. The SquashValidator already
    // checks if the current branch has uncommitted changes (which would be lost).
    // For non-current branches, dirty trees are allowed since we'll use a temp
    // worktree via ExecutionContextService to perform the squash.

    const parentBranch = validation.parentBranch!

    // Check for worktree conflicts and auto-detach clean worktrees
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath
    const worktreeValidation = SquashValidator.validateNoWorktreeConflicts(
      branchName,
      parentBranch,
      validation.descendantBranches,
      repo.worktrees,
      activeWorktreePath
    )

    if (!worktreeValidation.valid) {
      const { clean, dirty } = SquashValidator.partitionWorktreeConflicts(
        worktreeValidation.conflicts
      )

      // Dirty worktrees block the operation - user must handle them
      if (dirty.length > 0) {
        return {
          success: false,
          error: 'worktree_conflict',
          errorDetail: SquashValidator.formatWorktreeConflictMessage(dirty),
          worktreeConflicts: dirty
        }
      }

      // Auto-detach clean worktrees so we can modify their branches
      for (const conflict of clean) {
        const detachResult = await WorktreeOperation.detachHead(conflict.worktreePath)
        if (!detachResult.success) {
          return {
            success: false,
            error: 'worktree_conflict',
            errorDetail: `Failed to detach worktree at ${conflict.worktreePath}: ${detachResult.error}`,
            worktreeConflicts: [conflict]
          }
        }
      }
    }
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

    options.onPhaseComplete?.('validating')

    // Fast path: nothing to apply and no descendants to rebase.
    // This only needs to handle branch deletion, no temp worktree needed.
    if (isEmpty && descendants.length === 0) {
      options.onPhaseStart?.('handling-branches')
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
      if (
        originalBranch &&
        originalBranch !== branchName &&
        !branchResult.deletedBranch?.includes(originalBranch)
      ) {
        await git.checkout(repoPath, originalBranch)
      }

      options.onPhaseComplete?.('handling-branches')

      return {
        success: true,
        deletedBranch: branchResult.deletedBranch,
        preservedBranch: branchResult.preservedBranch
      }
    }

    // Main path: use a temporary worktree for git operations to keep user's
    // working directory untouched. The temp worktree shares .git with the main
    // repo, so branch operations performed there affect the main repo too.
    options.onPhaseStart?.('acquiring-context')
    const contextResult = await acquireSquashContext(repoPath, parentBranch)
    if (!contextResult.success) {
      return contextResult.error
    }
    const context = contextResult.context
    const executionPath = context.executionPath
    options.onPhaseComplete?.('acquiring-context')

    try {
      await git.checkout(executionPath, parentBranch)

      let newParentSha = parentHeadSha

      if (!isEmpty) {
        options.onPhaseStart?.('applying-patch')

        // Verify parent branch hasn't moved before patching
        await verifyBranchPosition(executionPath, parentBranch, parentHeadSha, git)

        const patch = await git.formatPatch(executionPath, `${parentBranch}..${branchName}`)
        const applyResult = await git.applyPatch(executionPath, patch)

        if (!applyResult.success) {
          options.onConflict?.(branchName, applyResult.conflicts ?? [])
          await safeReleaseContext(repoPath, context)
          return { success: false, error: 'conflict', conflicts: applyResult.conflicts }
        }

        await git.add(executionPath, ['.'])

        const targetCommit = await git.readCommit(executionPath, targetHeadSha)
        const currentIdentity = await getAuthorIdentity(repoPath)
        const commitMessage = options.commitMessage ?? targetCommit.message

        await git.commit(executionPath, {
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

        newParentSha = await git.resolveRef(executionPath, parentBranch)
        options.onPhaseComplete?.('applying-patch')
      }

      options.onPhaseStart?.('rebasing-descendants')
      const rebaseResult = await this.rebaseDescendants(
        repoPath,
        executionPath,
        parentBranch,
        directChild,
        descendants,
        originalShas,
        newParentSha,
        git,
        {
          onRebaseStart: options.onRebaseStart,
          onRebaseComplete: options.onRebaseComplete,
          onConflict: options.onConflict
        }
      )
      options.onPhaseComplete?.('rebasing-descendants')

      if (rebaseResult.status === 'conflict') {
        await this.rollbackBranches(
          executionPath,
          branchesToTrack,
          originalShas,
          git,
          null, // Don't restore branch in temp worktree
          originalHead,
          parentBranch
        )
        await safeReleaseContext(repoPath, context)
        return { success: false, error: 'descendant_conflict', conflicts: rebaseResult.conflicts }
      }

      if (rebaseResult.status === 'error') {
        await this.rollbackBranches(
          executionPath,
          branchesToTrack,
          originalShas,
          git,
          null, // Don't restore branch in temp worktree
          originalHead,
          parentBranch
        )
        await safeReleaseContext(repoPath, context)
        return { success: false, error: 'ancestry_mismatch', errorDetail: rebaseResult.message }
      }

      // Note: No auto-push after squash - user controls when to sync to remote
      // Collect the branches that were modified locally for the result
      const modifiedBranches: string[] = []
      for (const branch of [parentBranch, ...descendants]) {
        const originalSha = originalShas.get(branch)
        // Use executionPath here since that's where we made the changes
        const newSha = await git.resolveRef(executionPath, branch)
        if (originalSha !== newSha) {
          modifiedBranches.push(branch)
        }
      }

      // Release temp worktree BEFORE branch handling, since handleBranchAfterSquash
      // does git checkout operations that would fail if the branch is still checked
      // out in the temp worktree
      options.onPhaseStart?.('cleanup')
      await safeReleaseContext(repoPath, context)
      options.onPhaseComplete?.('cleanup')

      // handleBranchAfterSquash uses repoPath since it does branch operations
      // that should work the same in any worktree sharing .git
      options.onPhaseStart?.('handling-branches')
      const branchResult = await this.handleBranchAfterSquash(
        repoPath,
        parentBranch,
        branchName,
        options.branchChoice,
        forgeStateResult.state,
        git
      )

      // Only restore to original branch if user was on a completely different branch
      // (not one of the branches involved in the squash)
      // handleBranchAfterSquash already checked out to the preserved branch if user was on parent or child
      if (originalBranch && originalBranch !== parentBranch && originalBranch !== branchName) {
        await this.restoreBranch(repoPath, originalBranch, originalHead, parentBranch, git)
      }
      options.onPhaseComplete?.('handling-branches')

      return {
        success: true,
        modifiedBranches,
        deletedBranch: branchResult.deletedBranch,
        preservedBranch: branchResult.preservedBranch
      }
    } catch (error) {
      await this.rollbackBranches(
        executionPath,
        branchesToTrack,
        originalShas,
        git,
        null, // Don't restore branch in temp worktree
        originalHead,
        parentBranch
      )
      await safeReleaseContext(repoPath, context)
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
    mainRepoPath: string,
    executionPath: string,
    parentBranch: string,
    directChild: string | undefined,
    allDescendants: string[],
    originalShas: Map<string, string>,
    newParentSha: string,
    git: GitAdapter,
    callbacks?: {
      onRebaseStart?: (progress: SquashRebaseProgress) => void
      onRebaseComplete?: (progress: SquashRebaseProgress) => void
      onConflict?: (branch: string, conflicts: string[]) => void
    }
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

    const total = allDescendants.length
    for (let i = 0; i < allDescendants.length; i++) {
      const branch = allDescendants[i]
      const progress = { branch, index: i, total }
      const intentId = `squash-rebase-${branch}-${Date.now()}`

      callbacks?.onRebaseStart?.(progress)

      // Verify branch is still at expected position before rebasing
      const expectedSha = originalShas.get(branch)
      if (expectedSha) {
        await verifyBranchPosition(executionPath, branch, expectedSha, git)
      }

      // Write intent to MAIN repo BEFORE starting the rebase - enables crash recovery
      // TransactionService writes to .git/teapot-intent.json which must be in main repo
      await TransactionService.writeIntent(mainRepoPath, {
        id: intentId,
        type: 'squash-descendant-rebase',
        context: {
          branch,
          executionPath
        }
      })

      try {
        await TransactionService.markExecuting(mainRepoPath)

        await git.checkout(executionPath, branch)

        const rebaseResult = await git.rebase(executionPath, {
          onto: ontoSha,
          from: upstreamSha,
          to: branch
        })

        if (!rebaseResult.success) {
          if (supportsRebaseAbort(git)) {
            await git.rebaseAbort?.(executionPath)
          }
          await TransactionService.markFailed(mainRepoPath, {
            message: `Rebase conflict in ${branch}`,
            code: 'CONFLICT'
          })
          callbacks?.onConflict?.(branch, rebaseResult.conflicts)
          return { status: 'conflict', conflicts: rebaseResult.conflicts }
        }

        // Mark completed and commit the transaction
        await TransactionService.markCompleted(mainRepoPath)
        await TransactionService.commitIntent(mainRepoPath)

        callbacks?.onRebaseComplete?.(progress)

        upstreamSha = originalShas.get(branch) ?? (await git.resolveRef(executionPath, branch))
        ontoSha = await git.resolveRef(executionPath, branch)
      } catch (error) {
        await TransactionService.markFailed(mainRepoPath, {
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }

    await git.checkout(executionPath, parentBranch)
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

    // Check current branch to avoid "cannot delete checked out branch" errors
    const currentBranch = await git.currentBranch(repoPath)

    if (choice === 'parent') {
      // Keep parent branch, delete child branch and close its PR
      // If we're on the child branch, switch to parent first
      if (currentBranch === childBranch) {
        await git.checkout(repoPath, parentBranch)
      }
      await this.cleanupSquashedBranch(repoPath, childBranch, forgeState)
      // Ensure we end up on the preserved branch
      await git.checkout(repoPath, parentBranch)
      return { deletedBranch: childBranch, preservedBranch: parentBranch }
    }

    if (choice === 'child') {
      // Move child branch to result commit (which is now where parent points)
      // Delete parent branch and close its PR
      const resultSha = await git.resolveRef(repoPath, parentBranch)

      // If we're on the child branch, we need to handle this carefully:
      // 1. First checkout to parent (so we can delete/recreate child)
      // 2. Delete and recreate child at result
      // 3. Checkout to child
      // 4. Delete parent
      if (currentBranch === childBranch) {
        await git.checkout(repoPath, parentBranch)
      }

      // Update child branch to point to the result commit by deleting and recreating
      await git.deleteBranch(repoPath, childBranch)
      await git.branch(repoPath, childBranch, { startPoint: resultSha })

      // If we were on the child branch, switch back to it before deleting parent
      if (currentBranch === childBranch) {
        await git.checkout(repoPath, childBranch)
      } else if (currentBranch === parentBranch) {
        // If we're on parent, switch to child before deleting parent
        await git.checkout(repoPath, childBranch)
      }

      // Close parent's PR if it has one
      const parentPr = findOpenPr(parentBranch, forgeState.pullRequests)
      if (parentPr) {
        await gitForgeService.closePullRequest(repoPath, parentPr.number)
      }

      // Delete parent branch
      await BranchOperation.cleanup(repoPath, parentBranch)

      // Ensure we end up on the preserved branch
      await git.checkout(repoPath, childBranch)
      return { deletedBranch: parentBranch, preservedBranch: childBranch }
    }

    if (choice === 'both') {
      // Keep both branches pointing to the same commit
      // Child branch needs to be moved to the result commit
      const resultSha = await git.resolveRef(repoPath, parentBranch)

      // If on child branch, switch to parent first so we can delete/recreate child
      if (currentBranch === childBranch) {
        await git.checkout(repoPath, parentBranch)
      }

      // Update child branch by deleting and recreating at new position
      await git.deleteBranch(repoPath, childBranch)
      await git.branch(repoPath, childBranch, { startPoint: resultSha })

      // Ensure we end up on the parent branch (the "primary" preserved branch)
      await git.checkout(repoPath, parentBranch)
      // No branches deleted, no PRs closed
      return { preservedBranch: parentBranch }
    }

    // Custom name: create new branch with custom name, delete BOTH parent and child branches
    const customName = choice
    const resultSha = await git.resolveRef(repoPath, parentBranch)

    // Create new branch with the custom name at the result commit
    await git.branch(repoPath, customName, { startPoint: resultSha })

    // Switch to the new branch before deleting the others
    await git.checkout(repoPath, customName)

    // Note: No auto-push - user controls when to sync to remote

    // Delete both the parent and child branches (and close their PRs)
    await this.cleanupSquashedBranch(repoPath, childBranch, forgeState)
    await this.cleanupSquashedBranch(repoPath, parentBranch, forgeState)

    // Return comma-separated list of deleted branches
    return { deletedBranch: `${childBranch}, ${parentBranch}`, preservedBranch: customName }
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
