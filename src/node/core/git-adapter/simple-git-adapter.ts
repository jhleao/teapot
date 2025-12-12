/**
 * Simple-Git Adapter
 *
 * Git adapter implementation using simple-git library.
 * This uses the native Git CLI under the hood, providing better performance
 * and reliability for large repositories.
 */

import { log } from '@shared/logger'
import { exec } from 'child_process'
import fs from 'fs'
import { promisify } from 'util'

const execAsync = promisify(exec)
import path from 'path'
import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git'
import type { GitAdapter } from './interface'
import type {
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
  WorkingTreeStatus
} from './types'

export class SimpleGitAdapter implements GitAdapter {
  readonly name = 'simple-git'

  private createGit(dir: string): SimpleGit {
    return simpleGit(dir)
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
    } catch (error) {
      // Return empty string for non-existent refs
      return ''
    }
  }

  async currentBranch(dir: string): Promise<string | null> {
    try {
      const git = this.createGit(dir)
      const status = await git.status()
      return status.current ?? null
    } catch (error) {
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
    } catch (error) {
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

  async checkout(dir: string, ref: string, options?: CheckoutOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = []

      if (options?.force) {
        args.push('--force')
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

  // ============================================================================
  // Network Operations
  // ============================================================================

  async push(dir: string, options: PushOptions): Promise<void> {
    try {
      const git = this.createGit(dir)
      const args: string[] = [options.remote, options.ref]

      if (options.force) {
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
    try {
      const git = this.createGit(dir)
      await git.raw(['rebase', '--continue'])

      return {
        success: true,
        conflicts: [],
        currentCommit: await this.resolveRef(dir, 'HEAD')
      }
    } catch (error) {
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
    const gitDir = path.join(dir, '.git')
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

  private async detectRebase(dir: string): Promise<boolean> {
    const gitDir = path.join(dir, '.git')
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
