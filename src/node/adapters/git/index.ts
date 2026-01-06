/**
 * Git Adapter Module
 *
 * Provides a unified interface for Git operations that can be backed by
 * different Git implementations (isomorphic-git, simple-git, etc.)
 *
 * Usage:
 * ```typescript
 * import { getGitAdapter } from '@node/adapters/git'
 *
 * const git = getGitAdapter()
 * const commits = await git.log(repoPath, 'HEAD', { depth: 100 })
 * ```
 */

// Main exports
export {
  createGitAdapter,
  getAdapterInfo,
  getGitAdapter,
  resetGitAdapter,
  supportsFeature
} from './factory'
export type { GitAdapterConfig, GitAdapterType } from './factory'

// Interface and types
export {
  supportsCherryPick,
  supportsGetRebaseState,
  supportsMerge,
  supportsMergeBase,
  supportsRebase,
  supportsRebaseAbort,
  supportsRebaseContinue,
  supportsRebaseSkip
} from './interface'
export type { GitAdapter } from './interface'

// All type definitions
export type {
  Branch,
  BranchOptions,
  ApplyPatchResult,
  CheckoutOptions,
  CherryPickResult,
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
export { SimpleGitAdapter } from './SimpleGitAdapter'

// Utility functions
export {
  branchExists,
  canFastForward,
  findLocalTrunk,
  getAuthorIdentity,
  resolveTrunkRef
} from './utils'
export type { AuthorIdentity } from './utils'
