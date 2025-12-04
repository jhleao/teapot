/**
 * Simple-Git Adapter
 *
 * Git adapter implementation using simple-git library.
 * This uses the native Git CLI under the hood, providing better performance
 * and reliability for large repositories.
 */

import { log } from '@shared/logger'
import fs from 'fs'
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
      const conflicted = new Set<string>()

      for (const file of status.files) {
        const { path: filepath, index, working_dir } = file

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
        } else if (working_dir === 'U' || index === 'U') {
          conflicted.add(filepath)
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

  async add(dir: string, filepath: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.add(filepath)
    } catch (error) {
      throw this.createError('add', error)
    }
  }

  async resetIndex(dir: string, filepath: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      // Unstage file (reset index only, keep working tree)
      await git.reset(['--', filepath])
    } catch (error) {
      throw this.createError('resetIndex', error)
    }
  }

  async remove(dir: string, filepath: string): Promise<void> {
    try {
      const git = this.createGit(dir)
      await git.rm([filepath])
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
    })(`[SimpleGitAdapter] ${operation} failed: ${message}`, operation, originalError)
  }
}
