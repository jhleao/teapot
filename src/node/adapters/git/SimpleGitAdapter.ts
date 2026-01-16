/**
 * Simple-Git Adapter
 *
 * Git adapter implementation using simple-git library.
 * This uses the native Git CLI under the hood, providing better performance
 * and reliability for large repositories.
 */

import { log } from '@shared/logger'
import { exec, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git'
import { promisify } from 'util'
import type { GitAdapter } from './interface'
import type {
  ApplyPatchResult,
  BranchOptions,
  CheckoutOptions,
  Commit,
  CommitDetail,
  CommitOptions,
  GitError,
  LogOptions,
  PushOptions,
  RebaseOptions,
  RebaseResult,
  Remote,
  ResetOptions,
  WorkingTreeStatus,
  WorktreeInfo
} from './types'

const execAsync = promisify(exec)

export class SimpleGitAdapter implements GitAdapter {
  readonly name = 'simple-git'

  private createGit(dir: string): SimpleGit {
    return simpleGit(dir)
  }

  // ============================================================================
  // Repository Creation
  // ============================================================================

  async clone(url: string, targetPath: string): Promise<void> {
    try {
      const git = simpleGit()
      await git.clone(url, targetPath)
    } catch (error) {
      throw this.createError('clone', error)
    }
  }

  // ============================================================================
  // Repository Inspection
  // ============================================================================

  async listBranches(dir: string, options?: { remote?: string }): Promise<string[]> {
    try {
      const git = this.createGit(dir)
      const args: string[] = []

      if (options?.remote) {
        args.push('-r')
      }

      const summary = await git.branch(args)
      return summary.all
    } catch (error) {
      throw this.createError('listBranches', error)
    }
  }

  async listRemotes(dir: string): Promise<Remote[]> {
    try {
      const git = this.createGit(dir)
      const remotes = await git.getRemotes(true)
      return remotes.map((r) => ({
        name: r.name,
        url: r.refs.fetch || r.refs.push || ''
      }))
    } catch (error) {
      throw this.createError('listRemotes', error)
    }
  }

  async log(dir: string, ref: string, options?: LogOptions): Promise<Commit[]> {
    try {
      const git = this.createGit(dir)

      // Use custom format to get parent SHAs
      const format = {
        hash: '%H',
        parent: '%P',
        message: '%s',
        body: '%b',
        authorDate: '%ai'
      }

      const logOptions: any = {
        format
      }

      if (options?.depth !== undefined) {
        logOptions.maxCount = options.depth
      }

      // Add the ref as an argument to git log
      const result = await git.log([ref], logOptions)

      // Safety: Cap at maxCommits if specified
      const entriesToProcess = options?.maxCommits
        ? result.all.slice(0, options.maxCommits)
        : result.all

      return entriesToProcess.map((entry: any) => {
        // Parse parent - may have multiple parents for merges, take first
        const parents = entry.parent ? entry.parent.split(' ') : []
        const parentSha = parents[0] || ''

        return {
          sha: entry.hash,
          message: (entry.message + (entry.body ? '\n' + entry.body : '')).trim(),
          timeMs: new Date(entry.authorDate).getTime(),
          parentSha,
          childrenSha: [] // Populated by caller
        }
      })
    } catch (error) {
      // Silently return empty for branches we can't traverse
      log.debug(`[SimpleGitAdapter] log failed for ${ref}:`, error)
      return []
    }
  }

  async resolveRef(dir: string, ref: string): Promise<string> {
    try {
      const git = this.createGit(dir)
      const result = await git.revparse([ref])
      return result.trim()
    } catch {
      // Return empty string for non-existent refs
      return ''
    }
  }

  /**
   * Batch resolve multiple refs in a single git call.
   * Uses git for-each-ref for branches, which is much faster than individual rev-parse calls.
   *
   * @param dir - Repository directory path
   * @param refs - Array of refs to resolve (e.g., refs/heads/main, refs/remotes/origin/main)
   * @returns Map of ref -> sha (empty string if ref doesn't exist)
   */
  async resolveRefs(dir: string, refs: string[]): Promise<Map<string, string>> {
    if (refs.length === 0) {
      return new Map()
    }

    const result = new Map<string, string>()
    // Initialize all refs with empty string (not found)
    for (const ref of refs) {
      result.set(ref, '')
    }

    try {
      const git = this.createGit(dir)
      // Use for-each-ref to get all refs at once - much faster than individual calls
      // Format: refname + tab + objectname
      const output = await git.raw([
        'for-each-ref',
        '--format=%(refname)\t%(objectname)',
        'refs/heads',
        'refs/remotes'
      ])

      // Parse the output and populate the map
      for (const line of output.trim().split('\n')) {
        if (!line) continue
        const [refName, sha] = line.split('\t')
        if (refName && sha && result.has(refName)) {
          result.set(refName, sha)
        }
      }
    } catch {
      // If for-each-ref fails, fall back to individual resolves
      await Promise.all(
        refs.map(async (ref) => {
          result.set(ref, await this.resolveRef(dir, ref))
        })
      )
    }

    return result
  }

  async currentBranch(dir: string): Promise<string | null> {
    try {
      const git = this.createGit(dir)
      const status = await git.status()
      // simple-git returns "HEAD" as current when detached, so we need to check
      // the detached flag to return null for detached HEAD state
      if (status.detached) {
        return null
      }
      return status.current ?? null
    } catch {
      return null
    }
  }

  async getConfig(dir: string, configPath: string): Promise<string | undefined> {
    try {
      const git = this.createGit(dir)
      const result = await git.listConfig()

      // Find the config value
      const key = configPath.toLowerCase()
      const value = result.all[key]

      // Handle both string and string[] values
      if (Array.isArray(value)) {
        return value[0] ?? undefined
      }

      return value ?? undefined
    } catch {
      return undefined
    }
  }

  async readCommit(dir: string, sha: string): Promise<CommitDetail> {
    try {
      const git = this.createGit(dir)

      // Use git show with custom format to get all details
      const format = [
        '%H', // commit hash
        '%P', // parent hashes
        '%an', // author name
        '%ae', // author email
        '%at', // author timestamp
        '%cn', // committer name
        '%ce', // committer email
        '%ct', // committer timestamp
        '%B' // body (message)
      ].join('%n')

      const result = await git.show([sha, `--format=${format}`, '--no-patch'])
      const lines = result.split('\n')

      const hash = lines[0] || sha
      const parents = lines[1]?.split(' ') || []
      const authorName = lines[2] || ''
      const authorEmail = lines[3] || ''
      const authorTimestamp = parseInt(lines[4] || '0', 10)
      const committerName = lines[5] || ''
      const committerEmail = lines[6] || ''
      const committerTimestamp = parseInt(lines[7] || '0', 10)
      const message = lines.slice(8).join('\n').trim()

      return {
        sha: hash,
        message,
        timeMs: authorTimestamp * 1000,
        parentSha: parents[0] || '',
        author: {
          name: authorName,
          email: authorEmail,
          timestamp: authorTimestamp * 1000
        },
        committer: {
          name: committerName,
          email: committerEmail,
          timestamp: committerTimestamp * 1000
        }
      }
    } catch (error) {
      throw this.createError('readCommit', error)
    }
  }

  async getWorkingTreeStatus(dir: string): Promise<WorkingTreeStatus> {
    try {
      const git = this.createGit(dir)
      const status: StatusResult = await git.status()

      // Parse file statuses
      const staged = new Set<string>()
      const modified = new Set<string>()
      const created = new Set<string>()
      const deleted = new Set<string>()
      const renamed: string[] = []
      const notAdded = new Set<string>()
      // Use simple-git's built-in conflicted array which handles all conflict status codes
      const conflicted = new Set<string>(status.conflicted)

      for (const file of status.files) {
        const { path: filepath, index, working_dir } = file

        // Skip conflicted files - they're handled by status.conflicted
        if (conflicted.has(filepath)) {
          continue
        }

        // Index changes (staged)
        if (index === 'A') {
          created.add(filepath)
          staged.add(filepath)
        } else if (index === 'M') {
          staged.add(filepath)
        } else if (index === 'D') {
          deleted.add(filepath)
          staged.add(filepath)
        } else if (index === 'R') {
          renamed.push(filepath)
          staged.add(filepath)
        } else if (index === 'C') {
          // Copied (treat as created)
          created.add(filepath)
          staged.add(filepath)
        }

        // Working directory changes
        if (working_dir === 'M') {
          modified.add(filepath)
        } else if (working_dir === 'D') {
          deleted.add(filepath)
        } else if (working_dir === '?') {
          notAdded.add(filepath)
        }
      }

      // Collect all changed files
      const allChangedFiles = new Set<string>()
      ;[staged, modified, created, deleted, notAdded, conflicted].forEach((set) => {
        set.forEach((f) => allChangedFiles.add(f))
      })
      renamed.forEach((r) => allChangedFiles.add(r))

      // Get current HEAD SHA
      const currentCommitSha = await this.resolveRef(dir, 'HEAD')

      // Detect rebase state
      const isRebasing = await this.detectRebase(dir)

      return {
        currentBranch: status.current ?? 'HEAD',
        currentCommitSha,
        tracking: status.tracking ?? null,
        detached: status.detached,
        isRebasing,
        staged: Array.from(staged).sort(),
        modified: Array.from(modified).sort(),
        created: Array.from(created).sort(),
        deleted: Array.from(deleted).sort(),
        renamed,
        not_added: Array.from(notAdded).sort(),
        conflicted: Array.from(conflicted).sort(),
        allChangedFiles: Array.from(allChangedFiles).sort()
      }
    } catch (error) {
      throw this.createError('getWorkingTreeStatus', error)
    }
  }

  /**
   * List all worktrees in the repository.
   *
   * Parses output from `git worktree list --porcelain` which looks like:
   * ```
   * worktree /path/to/main
   * HEAD abc123...
   * branch refs/heads/main
   *
   * worktree /path/to/feature
   * HEAD def456...
   * branch refs/heads/feature
   * ```
   *
   * For bare worktrees (detached HEAD), there's no "branch" line.
   * For prunable (stale) worktrees, there's a "prunable" line.
   */
  async listWorktrees(
    dir: string,
    options?: { skipDirtyCheck?: boolean }
  ): Promise<WorktreeInfo[]> {
    try {
      const git = this.createGit(dir)
      const output = await git.raw(['worktree', 'list', '--porcelain'])

      // Phase 1: Parse all worktree info from git output
      const parsedWorktrees: Array<{
        path: string
        headSha: string
        branch: string | null
        isStale: boolean
        isMain: boolean
      }> = []

      const blocks = output.trim().split('\n\n')
      for (const block of blocks) {
        if (!block.trim()) continue

        const lines = block.split('\n')
        let worktreePath = ''
        let headSha = ''
        let branch: string | null = null
        let isStale = false

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktreePath = line.slice('worktree '.length)
          } else if (line.startsWith('HEAD ')) {
            headSha = line.slice('HEAD '.length)
          } else if (line.startsWith('branch ')) {
            // Strip refs/heads/ prefix
            branch = line.slice('branch '.length).replace('refs/heads/', '')
          } else if (line === 'prunable') {
            isStale = true
          }
        }

        if (!worktreePath) continue

        // First worktree in the list is always the main worktree
        const isMain = parsedWorktrees.length === 0

        parsedWorktrees.push({
          path: worktreePath,
          headSha,
          branch,
          isMain,
          isStale
        })
      }

      // Phase 2: Check dirty status (skip if requested for performance)
      if (options?.skipDirtyCheck) {
        // Fast path: skip dirty checking, all worktrees appear clean
        return parsedWorktrees.map((wt) => ({
          path: wt.path,
          headSha: wt.headSha,
          branch: wt.branch,
          isMain: wt.isMain,
          isStale: wt.isStale,
          isDirty: false
        }))
      }

      // Standard path: Check dirty status in parallel for all non-stale worktrees
      const worktrees = await Promise.all(
        parsedWorktrees.map(async (wt) => {
          const isDirty = wt.isStale ? false : await this.isWorktreeDirty(wt.path)
          return {
            path: wt.path,
            headSha: wt.headSha,
            branch: wt.branch,
            isMain: wt.isMain,
            isStale: wt.isStale,
            isDirty
          }
        })
      )

      return worktrees
    } catch (error) {
      throw this.createError('listWorktrees', error)
    }
  }

  /**
   * Prune stale worktree references.
   *
   * Removes worktree administrative files for worktrees that no longer exist
   * on disk. This cleans up git's internal worktree registry when worktrees
   * were deleted externally or by a crashed process.
   */
  async pruneWorktrees(dir: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.raw(['worktree', 'prune'])
    } catch (error) {
      throw this.createError('pruneWorktrees', error)
    }
  }

  /**
   * Check if a worktree has uncommitted changes.
   */
  private async isWorktreeDirty(worktreePath: string): Promise<boolean> {
    try {
      // Use git status --porcelain - any output means dirty
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: worktreePath
      })
      return stdout.trim().length > 0
    } catch {
      // If we can't check, assume clean (will show error state via isStale)
      return false
    }
  }

  // ============================================================================
  // Repository Mutation
  // ============================================================================

  async add(dir: string, filepath: string | string[]): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.add(filepath)
    } catch (error) {
      throw this.createError('add', error)
    }
  }

  async resetIndex(dir: string, filepath: string | string[]): Promise<void> {
    try {
      const git = this.createGit(dir)
      // Unstage file (reset index only, keep working tree)
      const files = Array.isArray(filepath) ? filepath : [filepath]
      await git.reset(['--', ...files])
    } catch (error) {
      throw this.createError('resetIndex', error)
    }
  }

  async remove(dir: string, filepath: string | string[]): Promise<void> {
    try {
      const git = this.createGit(dir)
      const files = Array.isArray(filepath) ? filepath : [filepath]
      await git.rm(files)
    } catch (error) {
      throw this.createError('remove', error)
    }
  }

  async commit(dir: string, options: CommitOptions): Promise<string> {
    try {
      const git = this.createGit(dir)

      // Build git commit options
      const gitOptions: Record<string, string | null> = {}

      if (options.author) {
        gitOptions['--author'] = `${options.author.name} <${options.author.email}>`
      }

      if (options.amend) {
        gitOptions['--amend'] = null
      }

      if (options.allowEmpty) {
        gitOptions['--allow-empty'] = null
      }

      const result = await git.commit(options.message, [], gitOptions as any)
      return result.commit
    } catch (error) {
      throw this.createError('commit', error)
    }
  }

  async branch(dir: string, ref: string, options?: BranchOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = [ref]

      if (options?.startPoint) {
        args.push(options.startPoint)
      }

      await git.branch(args)

      if (options?.checkout) {
        await git.checkout(ref)
      }
    } catch (error) {
      throw this.createError('branch', error)
    }
  }

  async deleteBranch(dir: string, ref: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.branch(['-D', ref])
    } catch (error) {
      throw this.createError('deleteBranch', error)
    }
  }

  async renameBranch(dir: string, oldRef: string, newRef: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.branch(['-m', oldRef, newRef])
    } catch (error) {
      throw this.createError('renameBranch', error)
    }
  }

  async deleteRemoteTrackingBranch(dir: string, remote: string, branch: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      // Use `git branch -rd` to delete a remote-tracking branch
      await git.branch(['-rd', `${remote}/${branch}`])
    } catch (error) {
      throw this.createError('deleteRemoteTrackingBranch', error)
    }
  }

  async checkout(dir: string, ref: string, options?: CheckoutOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = []

      if (options?.force) {
        args.push('--force')
      }

      if (options?.detach) {
        args.push('--detach')
      }

      if (options?.create) {
        args.push('-b')
      }

      args.push(ref)

      await git.checkout(args)
    } catch (error) {
      throw this.createError('checkout', error)
    }
  }

  async reset(dir: string, options: ResetOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = []

      if (options.mode === 'soft') {
        args.push('--soft')
      } else if (options.mode === 'mixed') {
        args.push('--mixed')
      } else if (options.mode === 'hard') {
        args.push('--hard')
      }

      args.push(options.ref)

      await git.reset(args)
    } catch (error) {
      throw this.createError('reset', error)
    }
  }

  /**
   * Generate a patch for a commit range.
   *
   * Uses `git format-patch --stdout` to preserve author metadata and binary hunks.
   */
  async formatPatch(dir: string, commitRange: string): Promise<string> {
    try {
      const git = this.createGit(dir)
      return await git.raw(['format-patch', '--stdout', '--binary', commitRange])
    } catch (error) {
      throw this.createError('formatPatch', error)
    }
  }

  /**
   * Apply a patch to the working tree.
   *
   * Performs a dry-run check first to surface conflicts before mutating state.
   */
  async applyPatch(dir: string, patch: string): Promise<ApplyPatchResult> {
    try {
      await this.runGitWithInput(dir, ['apply', '--check'], patch)
      await this.runGitWithInput(dir, ['apply'], patch)
      return { success: true }
    } catch (error) {
      const conflicts = this.parseApplyConflicts(error)
      return {
        success: false,
        conflicts: conflicts.length > 0 ? conflicts : undefined
      }
    }
  }

  /**
   * Determine whether a diff range has any changes.
   */
  async isDiffEmpty(dir: string, range: string): Promise<boolean> {
    try {
      const git = this.createGit(dir)
      const diff = await git.diff([range])
      return diff.trim().length === 0
    } catch (error) {
      throw this.createError('isDiffEmpty', error)
    }
  }

  // ============================================================================
  // Network Operations
  // ============================================================================

  async push(dir: string, options: PushOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = [options.remote, options.ref]

      if (options.forceWithLease) {
        if (typeof options.forceWithLease === 'object') {
          args.push(
            `--force-with-lease=${options.forceWithLease.ref}:${options.forceWithLease.expect}`
          )
        } else {
          args.push('--force-with-lease')
        }
      } else if (options.force) {
        args.push('--force')
      }

      if (options.setUpstream) {
        args.push('--set-upstream')
      }

      await git.push(args)
    } catch (error) {
      throw this.createError('push', error)
    }
  }

  async fetch(dir: string, remote = 'origin'): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.fetch(remote)
    } catch (error) {
      throw this.createError('fetch', error)
    }
  }

  // ============================================================================
  // Advanced Operations
  // ============================================================================

  async mergeBase(dir: string, ref1: string, ref2: string): Promise<string> {
    try {
      const git = this.createGit(dir)
      const result = await git.raw(['merge-base', ref1, ref2])
      return result.trim()
    } catch (error) {
      throw this.createError('mergeBase', error)
    }
  }

  /**
   * Check if a commit is an ancestor of another commit.
   *
   * Uses `git merge-base --is-ancestor` which exits with:
   * - 0 if possibleAncestor is an ancestor of descendant (or they're the same commit)
   * - 1 if possibleAncestor is NOT an ancestor of descendant
   * - 128 (or other) if refs don't exist or other error
   *
   * Note: We use execAsync here instead of simple-git because simple-git's raw()
   * method doesn't properly handle exit codes for commands like --is-ancestor
   * that use exit codes to communicate boolean results.
   *
   * @param dir - Repository directory path
   * @param possibleAncestor - The commit/ref that might be an ancestor
   * @param descendant - The commit/ref to check ancestry against
   * @returns true if possibleAncestor is an ancestor of (or equal to) descendant
   */
  async isAncestor(dir: string, possibleAncestor: string, descendant: string): Promise<boolean> {
    try {
      // Use execAsync because simple-git doesn't properly handle exit code 1
      // which git merge-base --is-ancestor uses to indicate "not an ancestor"
      // Using async exec prevents blocking the event loop during concurrent operations
      await execAsync(`git merge-base --is-ancestor ${possibleAncestor} ${descendant}`, {
        cwd: dir
      })
      return true
    } catch {
      // Non-zero exit code means either:
      // 1. Not an ancestor (exit code 1) - return false
      // 2. Invalid ref (exit code 128) - return false (graceful handling)
      // We don't distinguish between these cases - both mean "not an ancestor"
      return false
    }
  }

  /**
   * Rebase the current branch onto a new base.
   *
   * Uses `git rebase --onto <onto> <from>` to replay commits from <from> (exclusive)
   * to HEAD onto <onto>.
   *
   * IMPORTANT: The caller must checkout the target branch before calling this method.
   * Git rebase operates on the current branch.
   *
   * @param dir - Repository directory path
   * @param options - Rebase options (onto, from, to)
   * @returns RebaseResult indicating success or conflicts
   */
  async rebase(dir: string, options: RebaseOptions): Promise<RebaseResult> {
    try {
      const git = this.createGit(dir)

      // Build rebase command arguments
      // git rebase --onto <newbase> <upstream> [<branch>]
      // This replays commits from <upstream> (exclusive) to <branch> onto <newbase>
      const args = ['rebase', '--onto', options.onto]

      if (options.from) {
        args.push(options.from)
      }

      // Add the branch to rebase (required for proper operation)
      if (options.to) {
        args.push(options.to)
      }

      // Execute rebase
      await git.raw(args)

      return {
        success: true,
        conflicts: [],
        currentCommit: await this.resolveRef(dir, 'HEAD')
      }
    } catch (error) {
      // Check if it's a conflict situation
      const status = await this.getWorkingTreeStatus(dir)

      if (status.isRebasing && status.conflicted.length > 0) {
        return {
          success: false,
          conflicts: status.conflicted,
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      // Check if rebase is in progress but no conflicts (might be mid-rebase)
      if (status.isRebasing) {
        return {
          success: false,
          conflicts: [],
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      // Not a conflict, rethrow the error
      throw this.createError('rebase', error)
    }
  }

  /**
   * Continue a paused rebase after conflicts have been resolved.
   *
   * The user must have:
   * 1. Resolved all conflicts in the working tree
   * 2. Staged the resolved files with `git add`
   *
   * @param dir - Repository directory path
   * @returns RebaseResult indicating success or new conflicts
   */
  async rebaseContinue(dir: string): Promise<RebaseResult> {
    // Check for stale lock file
    const lockCheck = await this.checkForLockFile(dir)
    if (lockCheck.locked) {
      return {
        success: false,
        conflicts: [],
        currentCommit: await this.resolveRef(dir, 'HEAD'),
        error: `Git index is locked. A '.git/index.lock' file exists, possibly from a crashed process. Remove it manually if no Git operation is running.`
      }
    }

    try {
      const git = this.createGit(dir)
      // Set GIT_EDITOR to prevent editor popups during rebase continue
      const gitWithEnv = git.env({
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true'
      })

      // Use 20-second timeout to prevent indefinite hangs
      await this.withTimeout(
        () => gitWithEnv.raw(['rebase', '--continue']),
        20000,
        'rebase --continue'
      )

      return {
        success: true,
        conflicts: [],
        currentCommit: await this.resolveRef(dir, 'HEAD')
      }
    } catch (error) {
      // Check if it was a timeout
      if (error instanceof Error && error.message.includes('timed out')) {
        return {
          success: false,
          conflicts: [],
          currentCommit: await this.resolveRef(dir, 'HEAD'),
          error: error.message
        }
      }

      // Check for new conflicts
      const status = await this.getWorkingTreeStatus(dir)

      if (status.conflicted.length > 0) {
        return {
          success: false,
          conflicts: status.conflicted,
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      // If still rebasing but no conflicts, might need more work
      if (status.isRebasing) {
        return {
          success: false,
          conflicts: [],
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      throw this.createError('rebaseContinue', error)
    }
  }

  /**
   * Abort the current rebase and restore the repository to its pre-rebase state.
   *
   * @param dir - Repository directory path
   */
  async rebaseAbort(dir: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.raw(['rebase', '--abort'])
    } catch (error) {
      throw this.createError('rebaseAbort', error)
    }
  }

  /**
   * Skip the current commit during a rebase.
   *
   * Use this when a commit's changes are already present in the target branch
   * (e.g., after a squash merge) or when you want to drop the commit.
   *
   * @param dir - Repository directory path
   * @returns RebaseResult indicating success or new conflicts
   */
  async rebaseSkip(dir: string): Promise<RebaseResult> {
    try {
      const git = this.createGit(dir)
      await git.raw(['rebase', '--skip'])

      return {
        success: true,
        conflicts: [],
        currentCommit: await this.resolveRef(dir, 'HEAD')
      }
    } catch (error) {
      // Check for new conflicts on next commit
      const status = await this.getWorkingTreeStatus(dir)

      if (status.conflicted.length > 0) {
        return {
          success: false,
          conflicts: status.conflicted,
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      if (status.isRebasing) {
        return {
          success: false,
          conflicts: [],
          currentCommit: await this.resolveRef(dir, 'HEAD')
        }
      }

      throw this.createError('rebaseSkip', error)
    }
  }

  /**
   * Get information about the current rebase state.
   *
   * Reads from .git/rebase-merge or .git/rebase-apply directories to get
   * details about an in-progress rebase.
   *
   * @param dir - Repository directory path
   * @returns Rebase state information or null if no rebase is in progress
   */
  async getRebaseState(dir: string): Promise<{
    branch: string
    onto: string
    originalHead: string
    currentStep: number
    totalSteps: number
  } | null> {
    const gitDir = await this.resolveGitDir(dir)
    const rebaseMergePath = path.join(gitDir, 'rebase-merge')
    const rebaseApplyPath = path.join(gitDir, 'rebase-apply')

    // Check for rebase-merge (standard rebase)
    try {
      await fs.promises.access(rebaseMergePath)

      const [headName, onto, origHead, msgnum, end] = await Promise.all([
        fs.promises.readFile(path.join(rebaseMergePath, 'head-name'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseMergePath, 'onto'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseMergePath, 'orig-head'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseMergePath, 'msgnum'), 'utf-8').catch(() => '0'),
        fs.promises.readFile(path.join(rebaseMergePath, 'end'), 'utf-8').catch(() => '0')
      ])

      return {
        branch: headName.trim().replace('refs/heads/', ''),
        onto: onto.trim(),
        originalHead: origHead.trim(),
        currentStep: parseInt(msgnum.trim(), 10),
        totalSteps: parseInt(end.trim(), 10)
      }
    } catch {
      // Not a rebase-merge
    }

    // Check for rebase-apply (git am style rebase)
    try {
      await fs.promises.access(rebaseApplyPath)

      const [headName, onto, origHead, next, last] = await Promise.all([
        fs.promises.readFile(path.join(rebaseApplyPath, 'head-name'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseApplyPath, 'onto'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseApplyPath, 'orig-head'), 'utf-8').catch(() => ''),
        fs.promises.readFile(path.join(rebaseApplyPath, 'next'), 'utf-8').catch(() => '0'),
        fs.promises.readFile(path.join(rebaseApplyPath, 'last'), 'utf-8').catch(() => '0')
      ])

      return {
        branch: headName.trim().replace('refs/heads/', ''),
        onto: onto.trim(),
        originalHead: origHead.trim(),
        currentStep: parseInt(next.trim(), 10),
        totalSteps: parseInt(last.trim(), 10)
      }
    } catch {
      // Not a rebase-apply
    }

    return null
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async runGitWithInput(
    dir: string,
    args: string[],
    input: string
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: dir })
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const message = stderr.trim() || stdout.trim() || `git ${args.join(' ')} failed`
          const error = new Error(message)
          ;(error as any).stdout = stdout
          ;(error as any).stderr = stderr
          ;(error as any).exitCode = code
          reject(error)
        }
      })

      child.stdin?.end(input)
    })
  }

  private parseApplyConflicts(error: unknown): string[] {
    const outputParts: string[] = []

    if (error && typeof error === 'object') {
      const errObj = error as any
      if (typeof errObj.stderr === 'string') {
        outputParts.push(errObj.stderr)
      }
      if (typeof errObj.stdout === 'string') {
        outputParts.push(errObj.stdout)
      }
      if ('message' in errObj && typeof errObj.message === 'string') {
        outputParts.push(errObj.message)
      }
    } else if (error) {
      outputParts.push(String(error))
    }

    const combined = outputParts.join('\n')
    const conflicts = new Set<string>()

    for (const line of combined.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const patchFailed = trimmed.match(/patch failed:\s*(.+?):\d+/i)
      if (patchFailed?.[1]) {
        conflicts.add(patchFailed[1])
        continue
      }

      const rejectMatch = trimmed.match(/error:\s*(.+)/i)
      if (rejectMatch?.[1]) {
        const message = rejectMatch[1].trim()
        const pathOnly = message.split(':')[0]
        conflicts.add(pathOnly || message)
      }
    }

    if (conflicts.size > 0) {
      return [...conflicts]
    }

    return combined
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  private async detectRebase(dir: string): Promise<boolean> {
    const gitDir = await this.resolveGitDir(dir)
    const rebaseMerge = path.join(gitDir, 'rebase-merge')
    const rebaseApply = path.join(gitDir, 'rebase-apply')

    try {
      await fs.promises.access(rebaseMerge)
      return true
    } catch {
      try {
        await fs.promises.access(rebaseApply)
        return true
      } catch {
        return false
      }
    }
  }

  /**
   * Resolve the actual git directory path.
   * In linked worktrees, .git is a file containing "gitdir: /path/to/actual/git/dir".
   * In regular repos, .git is a directory.
   */
  private async resolveGitDir(dir: string): Promise<string> {
    const gitPath = path.join(dir, '.git')
    try {
      const stat = await fs.promises.stat(gitPath)
      if (stat.isDirectory()) {
        return gitPath
      }
      // It's a file - read the gitdir pointer
      const content = await fs.promises.readFile(gitPath, 'utf-8')
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (match) {
        const linkedGitDir = match[1].trim()
        // Handle relative paths
        if (path.isAbsolute(linkedGitDir)) {
          return linkedGitDir
        }
        return path.resolve(dir, linkedGitDir)
      }
      // Fallback if format doesn't match
      return gitPath
    } catch {
      // If we can't stat, assume it's a directory
      return gitPath
    }
  }

  private async checkForLockFile(dir: string): Promise<{ locked: boolean; lockPath?: string }> {
    const gitDir = await this.resolveGitDir(dir)
    const indexLockPath = path.join(gitDir, 'index.lock')
    try {
      await fs.promises.access(indexLockPath)
      return { locked: true, lockPath: indexLockPath }
    } catch {
      return { locked: false }
    }
  }

  private async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Git '${operationName}' timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    })
    return Promise.race([operation(), timeoutPromise]).finally(() => {
      clearTimeout(timeoutId)
    })
  }

  // ============================================================================
  // Merge Operations
  // ============================================================================

  async merge(
    dir: string,
    branch: string,
    options?: import('@shared/types/repo').MergeOptions
  ): Promise<import('@shared/types/repo').MergeResult> {
    try {
      const git = this.createGit(dir)
      const args = ['merge']

      if (options?.ffOnly) {
        args.push('--ff-only')
      }

      args.push(branch)

      const result = await git.raw(args)

      return {
        success: true,
        fastForward: result.includes('Fast-forward'),
        alreadyUpToDate: result.includes('Already up to date')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        success: false,
        fastForward: false,
        error: errorMessage.includes('Not possible to fast-forward')
          ? 'Cannot fast-forward: local branch has diverged or has unpushed commits'
          : errorMessage
      }
    }
  }

  private createError(operation: string, originalError: unknown): GitError {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    return new (class extends Error implements GitError {
      name = 'GitError'
      operation: string
      originalError: unknown

      constructor(msg: string, op: string, orig: unknown) {
        super(msg)
        this.operation = op
        this.originalError = orig
      }
    })(`[SimpleGitAdapter] ${operation} failed: ${message}`, operation, originalError)
  }
}
