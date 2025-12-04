/**
 * Git Adapter Module
 *
 * Provides a unified interface for Git operations that can be backed by
 * different Git implementations (isomorphic-git, simple-git, etc.)
 *
 * Usage:
 * ```typescript
 * import { getGitAdapter } from '@node/core/git-adapter'
 *
 * const git = getGitAdapter()
 * const commits = await git.log(repoPath, 'HEAD', { depth: 100 })
 * ```
 */

// Main exports
export { createGitAdapter, getGitAdapter, getAdapterInfo, resetGitAdapter, supportsFeature } from './factory'
export type { GitAdapterConfig, GitAdapterType } from './factory'

// Interface and types
export type { GitAdapter } from './interface'
export { supportsCherryPick, supportsMergeBase, supportsRebase } from './interface'

// All type definitions
export type {
  Branch,
  BranchOptions,
  CherryPickResult,
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

// Adapter implementations (for testing)
export { SimpleGitAdapter } from './simple-git-adapter'
