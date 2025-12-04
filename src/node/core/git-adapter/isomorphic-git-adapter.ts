/**
 * Isomorphic-Git Adapter
 *
 * Git adapter implementation using isomorphic-git library.
 * This is the current implementation extracted into the adapter pattern.
 */

import { log } from '@shared/logger'
import fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import path from 'path'
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
  Remote,
  ResetOptions,
  WorkingTreeStatus
} from './types'

export class IsomorphicGitAdapter implements GitAdapter {
  readonly name = 'isomorphic-git'

  // ============================================================================
  // Repository Inspection
  // ============================================================================

  async listBranches(dir: string, options?: { remote?: string }): Promise<string[]> {
    try {
      return await git.listBranches({
        fs,
        dir,
        remote: options?.remote
      })
    } catch (error) {
      throw this.createError('listBranches', error)
    }
  }

  async listRemotes(dir: string): Promise<Remote[]> {
    try {
      const remotes = await git.listRemotes({ fs, dir })
      return remotes.map((r) => ({
        name: r.remote,
        url: r.url
      }))
    } catch (error) {
      throw this.createError('listRemotes', error)
    }
  }

  async log(dir: string, ref: string, options?: LogOptions): Promise<Commit[]> {
    try {
      const logOptions: any = {
        fs,
        dir,
        ref
      }

      if (options?.depth !== undefined) {
        logOptions.depth = options.depth
      }

      const logEntries = await git.log(logOptions)

      // Safety: Cap at maxCommits if specified
      const entriesToProcess = options?.maxCommits
        ? logEntries.slice(0, options.maxCommits)
        : logEntries

      return entriesToProcess.map((entry) => ({
        sha: entry.oid,
        message: entry.commit.message.trim(),
        timeMs: (entry.commit.author?.timestamp ?? 0) * 1000,
        parentSha: entry.commit.parent?.[0] ?? '',
        childrenSha: [] // Populated by caller
      }))
    } catch (error) {
      // Silently return empty for branches we can't traverse (shallow clones, etc.)
      log.debug(`[IsomorphicGitAdapter] log failed for ${ref}:`, error)
      return []
    }
  }

  async resolveRef(dir: string, ref: string): Promise<string> {
    try {
      return await git.resolveRef({
        fs,
        dir,
        ref
      })
    } catch (error) {
      // Return empty string for non-existent refs
      return ''
    }
  }

  async currentBranch(dir: string): Promise<string | null> {
    try {
      const branch = await git.currentBranch({ fs, dir, fullname: false })
      return branch ?? null
    } catch (error) {
      return null
    }
  }

  async getConfig(dir: string, path: string): Promise<string | undefined> {
    try {
      return await git.getConfig({
        fs,
        dir,
        path
      })
    } catch (error) {
      return undefined
    }
  }

  async readCommit(dir: string, sha: string): Promise<CommitDetail> {
    try {
      const commit = await git.readCommit({ fs, dir, oid: sha })

      return {
        sha,
        message: commit.commit.message.trim(),
        timeMs: (commit.commit.author?.timestamp ?? 0) * 1000,
        parentSha: commit.commit.parent?.[0] ?? '',
        author: {
          name: commit.commit.author?.name ?? '',
          email: commit.commit.author?.email ?? '',
          timestamp: (commit.commit.author?.timestamp ?? 0) * 1000
        },
        committer: {
          name: commit.commit.committer?.name ?? '',
          email: commit.commit.committer?.email ?? '',
          timestamp: (commit.commit.committer?.timestamp ?? 0) * 1000
        }
      }
    } catch (error) {
      throw this.createError('readCommit', error)
    }
  }

  async getWorkingTreeStatus(dir: string): Promise<WorkingTreeStatus> {
    // Get current HEAD SHA
    const headSha = await this.resolveRef(dir, 'HEAD')

    // Get current branch
    let branchName: string | null = null
    try {
      const resolvedBranch = await git.currentBranch({ fs, dir, fullname: false })
      branchName = resolvedBranch ?? null
    } catch {
      branchName = null
    }

    const detached = !branchName
    const currentBranch = branchName ?? 'HEAD'

    // Get tracking branch
    let tracking: string | null = null
    if (branchName) {
      tracking = await this.resolveTrackingBranch(dir, branchName)
    }

    // Detect rebase state
    const isRebasing = await this.detectRebase(dir)

    // Get status matrix
    let matrix: Array<[string, number, number, number]> = []
    try {
      matrix = await git.statusMatrix({ fs, dir })
    } catch {
      matrix = []
    }

    // Parse status matrix
    const staged = new Set<string>()
    const modified = new Set<string>()
    const created = new Set<string>()
    const deleted = new Set<string>()
    const renamed = new Set<string>()
    const notAdded = new Set<string>()
    const conflicted = new Set<string>()

    const FILE = 0
    const HEAD = 1
    const WORKDIR = 2
    const STAGE = 3

    for (const row of matrix) {
      const filepath = row[FILE]!
      const headStatus = row[HEAD]!
      const workdirStatus = row[WORKDIR]!
      const stageStatus = row[STAGE]!

      // File is staged if HEAD != STAGE
      if (headStatus !== stageStatus) {
        staged.add(filepath)
      }

      // File is modified if STAGE != WORKDIR (and file is tracked)
      const isTracked = headStatus !== 0 || stageStatus !== 0
      if (stageStatus !== workdirStatus && isTracked) {
        modified.add(filepath)
      }

      // File is created if it didn't exist in HEAD
      if (headStatus === 0) {
        if (stageStatus === 0 && workdirStatus === 2) {
          // Untracked
          notAdded.add(filepath)
        } else if (stageStatus > 0) {
          // New file staged
          created.add(filepath)
        }
      }

      // File is deleted if it existed in HEAD but not in STAGE or WORKDIR
      if (headStatus === 1 && (stageStatus === 0 || workdirStatus === 0)) {
        deleted.add(filepath)
      }
    }

    // Collect all changed files
    const allChangedFilesSet = new Set<string>()
    const addAll = (values: Set<string>): void => {
      values.forEach((value) => allChangedFilesSet.add(value))
    }
    ;[staged, modified, created, deleted, renamed, notAdded, conflicted].forEach(addAll)

    return {
      currentBranch,
      currentCommitSha: headSha,
      tracking,
      detached,
      isRebasing,
      staged: this.toSortedArray(staged),
      modified: this.toSortedArray(modified),
      created: this.toSortedArray(created),
      deleted: this.toSortedArray(deleted),
      renamed: [], // isomorphic-git doesn't detect renames
      not_added: this.toSortedArray(notAdded),
      conflicted: this.toSortedArray(conflicted),
      allChangedFiles: this.toSortedArray(allChangedFilesSet)
    }
  }

  // ============================================================================
  // Repository Mutation
  // ============================================================================

  async add(dir: string, filepath: string): Promise<void> {
    try {
      await git.add({ fs, dir, filepath })
    } catch (error) {
      throw this.createError('add', error)
    }
  }

  async resetIndex(dir: string, filepath: string): Promise<void> {
    try {
      await git.resetIndex({ fs, dir, filepath })
    } catch (error) {
      throw this.createError('resetIndex', error)
    }
  }

  async remove(dir: string, filepath: string): Promise<void> {
    try {
      await git.remove({ fs, dir, filepath })
    } catch (error) {
      throw this.createError('remove', error)
    }
  }

  async commit(dir: string, options: CommitOptions): Promise<string> {
    try {
      const commitOptions: any = {
        fs,
        dir,
        message: options.message
      }

      if (options.author) {
        commitOptions.author = {
          name: options.author.name,
          email: options.author.email
        }
      }

      if (options.committer) {
        commitOptions.committer = {
          name: options.committer.name,
          email: options.committer.email
        }
      }

      return await git.commit(commitOptions)
    } catch (error) {
      throw this.createError('commit', error)
    }
  }

  async branch(dir: string, ref: string, options?: BranchOptions): Promise<void> {
    try {
      await git.branch({ fs, dir, ref, checkout: options?.checkout ?? false })

      if (options?.startPoint) {
        // isomorphic-git doesn't support startPoint directly
        // Would need to create branch then reset to startPoint
        log.warn('[IsomorphicGitAdapter] startPoint not supported for branch creation')
      }
    } catch (error) {
      throw this.createError('branch', error)
    }
  }

  async deleteBranch(dir: string, ref: string): Promise<void> {
    try {
      await git.deleteBranch({ fs, dir, ref })
    } catch (error) {
      throw this.createError('deleteBranch', error)
    }
  }

  async checkout(dir: string, ref: string, options?: CheckoutOptions): Promise<void> {
    try {
      await git.checkout({ fs, dir, ref, force: options?.force })

      if (options?.create) {
        // isomorphic-git doesn't support -b flag directly
        log.warn('[IsomorphicGitAdapter] create option not supported for checkout')
      }
    } catch (error) {
      throw this.createError('checkout', error)
    }
  }

  async reset(dir: string, options: ResetOptions): Promise<void> {
    try {
      // isomorphic-git doesn't have a reset command
      // For soft reset, we manually write HEAD
      if (options.mode === 'soft') {
        await this.softResetManual(dir, options.ref)
      } else {
        throw new Error(`Reset mode '${options.mode}' not supported by isomorphic-git adapter`)
      }
    } catch (error) {
      throw this.createError('reset', error)
    }
  }

  // ============================================================================
  // Network Operations
  // ============================================================================

  async push(dir: string, options: PushOptions): Promise<void> {
    try {
      const pushOptions: any = {
        fs,
        dir,
        http,
        remote: options.remote,
        ref: options.ref,
        force: options.force
      }

      if (options.credentials) {
        pushOptions.onAuth = () => ({
          username: options.credentials!.username,
          password: options.credentials!.password
        })
      }

      await git.push(pushOptions)
    } catch (error) {
      throw this.createError('push', error)
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async resolveTrackingBranch(dir: string, branchName: string): Promise<string | null> {
    try {
      const remoteName = await git.getConfig({
        fs,
        dir,
        path: `branch.${branchName}.remote`
      })
      const mergeRef = await git.getConfig({
        fs,
        dir,
        path: `branch.${branchName}.merge`
      })
      if (!remoteName || !mergeRef) {
        return null
      }
      const normalized = mergeRef.replace(/^refs\/heads\//, '')
      return `${remoteName}/${normalized}`
    } catch {
      return null
    }
  }

  private async detectRebase(dir: string): Promise<boolean> {
    const gitDir = path.join(dir, '.git')
    return (
      (await this.pathExists(path.join(gitDir, 'rebase-merge'))) ||
      (await this.pathExists(path.join(gitDir, 'rebase-apply')))
    )
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private toSortedArray(values: Set<string>): string[] {
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }

  /**
   * Manual soft reset implementation (workaround for isomorphic-git)
   * Directly writes to .git/HEAD file
   */
  private async softResetManual(dir: string, ref: string): Promise<void> {
    const gitDir = path.join(dir, '.git')
    const sha = await this.resolveRef(dir, ref)

    if (!sha) {
      throw new Error(`Cannot resolve ref: ${ref}`)
    }

    // Write SHA directly to HEAD (detached state)
    await fs.promises.writeFile(path.join(gitDir, 'HEAD'), sha + '\n')
  }

  private createError(operation: string, originalError: unknown): GitError {
    const message =
      originalError instanceof Error ? originalError.message : String(originalError)
    return new (class extends Error implements GitError {
      name = 'GitError'
      operation: string
      originalError: unknown

      constructor(msg: string, op: string, orig: unknown) {
        super(msg)
        this.operation = op
        this.originalError = orig
      }
    })(`[IsomorphicGitAdapter] ${operation} failed: ${message}`, operation, originalError)
  }
}
