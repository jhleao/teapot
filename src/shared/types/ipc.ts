import { IpcMainInvokeEvent } from 'electron'
import type { ForgeStateResult, MergeStrategy } from './git-forge'
import type { RebaseState, WorktreeConflict } from './rebase'
import type { SquashPreview, SquashResult } from './squash'
import type { LocalRepo, UiState } from './ui'

/**
 * Response type for rebase operations (continue, abort, skip)
 */
export type RebaseOperationResponse = {
  success: boolean
  /** Error message if success is false */
  error?: string
  /** Updated UI state after the operation */
  uiState: UiState | null
  /** Conflicts if the operation resulted in new conflicts */
  conflicts?: string[]
}

/**
 * Response type for rebase status queries
 */
export type RebaseStatusResponse = {
  /** Whether a rebase is in progress (either our session or Git's) */
  isRebasing: boolean
  /** Whether we have an active session for this repo */
  hasSession: boolean
  /** Current rebase state if we have a session */
  state?: RebaseState
  /** Conflicted files if any */
  conflicts: string[]
  /** Progress info from Git if available */
  progress?: {
    currentStep: number
    totalSteps: number
    branch: string
  }
}

/**
 * Response type for checkout operations
 */
export type CheckoutResponse = {
  uiState: UiState | null
}

/**
 * Response type for Ship It operations
 */
export type ShipItResponse = {
  uiState: UiState | null
  /** Message to display to user */
  message?: string
  /** Whether remaining branches need rebasing */
  needsRebase?: boolean
}

/**
 * Response type for sync trunk operations
 */
export type SyncTrunkResponse = {
  uiState: UiState | null
  /** Status of the sync operation */
  status: 'success' | 'conflict' | 'error'
  /** Message to display to user */
  message?: string
}

/**
 * Response type for submitRebaseIntent.
 * Returns either the rebase preview or worktree conflicts that block the rebase.
 */
export type SubmitRebaseIntentResponse =
  | {
      success: true
      uiState: UiState
    }
  | {
      success: false
      error: 'WORKTREE_CONFLICT'
      worktreeConflicts: WorktreeConflict[]
      message: string
    }
  | null

/**
 * IPC Channel names - single source of truth for channel identifiers
 */
export const IPC_CHANNELS = {
  getRepo: 'getRepo',
  getForgeState: 'getForgeState',
  submitRebaseIntent: 'submitRebaseIntent',
  confirmRebaseIntent: 'confirmRebaseIntent',
  cancelRebaseIntent: 'cancelRebaseIntent',
  resolveWorktreeConflictAndRebase: 'resolveWorktreeConflictAndRebase',
  continueRebase: 'continueRebase',
  abortRebase: 'abortRebase',
  skipRebaseCommit: 'skipRebaseCommit',
  getRebaseStatus: 'getRebaseStatus',
  discardStaged: 'discardStaged',
  amend: 'amend',
  commit: 'commit',
  setFilesStageStatus: 'setFilesStageStatus',
  getLocalRepos: 'getLocalRepos',
  selectLocalRepo: 'selectLocalRepo',
  addLocalRepo: 'addLocalRepo',
  removeLocalRepo: 'removeLocalRepo',
  showFolderPicker: 'showFolderPicker',
  watchRepo: 'watchRepo',
  unwatchRepo: 'unwatchRepo',
  checkout: 'checkout',
  deleteBranch: 'deleteBranch',
  cleanupBranch: 'cleanupBranch',
  getGithubPat: 'getGithubPat',
  setGithubPat: 'setGithubPat',
  getMergeStrategy: 'getMergeStrategy',
  setMergeStrategy: 'setMergeStrategy',
  createPullRequest: 'createPullRequest',
  uncommit: 'uncommit',
  updatePullRequest: 'updatePullRequest',
  getFoldPreview: 'getFoldPreview',
  foldIntoParent: 'foldIntoParent',
  shipIt: 'shipIt',
  syncTrunk: 'syncTrunk',
  createBranch: 'createBranch',
  renameBranch: 'renameBranch',
  resumeRebaseQueue: 'resumeRebaseQueue',
  dismissRebaseQueue: 'dismissRebaseQueue',
  // Settings
  getPreferredEditor: 'getPreferredEditor',
  setPreferredEditor: 'setPreferredEditor',
  // Worktree
  getActiveWorktree: 'getActiveWorktree',
  switchWorktree: 'switchWorktree',
  removeWorktree: 'removeWorktree',
  discardWorktreeChanges: 'discardWorktreeChanges',
  checkoutWorktreeBranch: 'checkoutWorktreeBranch',
  openWorktreeInEditor: 'openWorktreeInEditor',
  openWorktreeInTerminal: 'openWorktreeInTerminal',
  copyWorktreePath: 'copyWorktreePath',
  createWorktree: 'createWorktree',
  // Clone
  cloneRepository: 'cloneRepository',
  getLastClonePath: 'getLastClonePath',
  readClipboardText: 'readClipboardText',
  checkCloneFolderName: 'checkCloneFolderName',
  checkTargetPath: 'checkTargetPath'
} as const

export const IPC_EVENTS = {
  repoChange: 'repoChange',
  repoError: 'repoError',
  rebaseWarning: 'rebaseWarning',
  updateDownloading: 'updateDownloading',
  updateDownloaded: 'updateDownloaded'
} as const

/**
 * IPC Request/Response type mappings
 * Each channel maps to: [RequestType, ResponseType]
 */
export interface IpcContract {
  [IPC_CHANNELS.getRepo]: {
    request: { repoPath: string; declutterTrunk?: boolean }
    response: UiState | null
  }
  [IPC_CHANNELS.getForgeState]: {
    request: { repoPath: string; forceRefresh?: boolean }
    response: ForgeStateResult
  }
  [IPC_CHANNELS.submitRebaseIntent]: {
    request: { repoPath: string; headSha: string; baseSha: string }
    response: SubmitRebaseIntentResponse
  }
  [IPC_CHANNELS.confirmRebaseIntent]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.cancelRebaseIntent]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.resolveWorktreeConflictAndRebase]: {
    request: {
      repoPath: string
      headSha: string
      baseSha: string
      resolutions: Array<{ worktreePath: string; action: 'stash' | 'delete' }>
    }
    response: SubmitRebaseIntentResponse
  }
  [IPC_CHANNELS.continueRebase]: {
    request: { repoPath: string }
    response: RebaseOperationResponse
  }
  [IPC_CHANNELS.abortRebase]: {
    request: { repoPath: string }
    response: RebaseOperationResponse
  }
  [IPC_CHANNELS.skipRebaseCommit]: {
    request: { repoPath: string }
    response: RebaseOperationResponse
  }
  [IPC_CHANNELS.getRebaseStatus]: {
    request: { repoPath: string }
    response: RebaseStatusResponse
  }
  [IPC_CHANNELS.discardStaged]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.amend]: {
    request: { repoPath: string; message?: string }
    response: UiState | null
  }
  [IPC_CHANNELS.commit]: {
    request: { repoPath: string; message: string; newBranchName?: string }
    response: UiState | null
  }
  [IPC_CHANNELS.setFilesStageStatus]: {
    request: { repoPath: string; staged: boolean; files: string[] }
    response: UiState | null
  }
  [IPC_CHANNELS.getLocalRepos]: {
    request: void
    response: LocalRepo[]
  }
  [IPC_CHANNELS.selectLocalRepo]: {
    request: { path: string }
    response: LocalRepo[]
  }
  [IPC_CHANNELS.addLocalRepo]: {
    request: { path: string }
    response: LocalRepo[]
  }
  [IPC_CHANNELS.removeLocalRepo]: {
    request: { path: string }
    response: LocalRepo[]
  }
  [IPC_CHANNELS.showFolderPicker]: {
    request: void
    response: string | null
  }
  [IPC_CHANNELS.watchRepo]: {
    request: { repoPath: string }
    response: void
  }
  [IPC_CHANNELS.unwatchRepo]: {
    request: { repoPath: string }
    response: void
  }
  [IPC_CHANNELS.checkout]: {
    request: { repoPath: string; ref: string }
    response: CheckoutResponse
  }
  [IPC_CHANNELS.deleteBranch]: {
    request: { repoPath: string; branchName: string }
    response: UiState | null
  }
  [IPC_CHANNELS.cleanupBranch]: {
    request: { repoPath: string; branchName: string }
    response: UiState | null
  }
  [IPC_CHANNELS.getGithubPat]: {
    request: void
    response: string | null
  }
  [IPC_CHANNELS.setGithubPat]: {
    request: { token: string }
    response: void
  }

  [IPC_CHANNELS.getPreferredEditor]: {
    request: void
    response: string | null
  }
  [IPC_CHANNELS.setPreferredEditor]: {
    request: { editor: string }
    response: void
  }
  [IPC_CHANNELS.getMergeStrategy]: {
    request: void
    response: MergeStrategy
  }
  [IPC_CHANNELS.setMergeStrategy]: {
    request: { strategy: MergeStrategy }
    response: void
  }
  [IPC_CHANNELS.createPullRequest]: {
    request: {
      repoPath: string
      headBranch: string
    }
    response: UiState | null
  }
  [IPC_CHANNELS.uncommit]: {
    request: { repoPath: string; commitSha: string }
    response: UiState | null
  }
  [IPC_CHANNELS.updatePullRequest]: {
    request: {
      repoPath: string
      headBranch: string
    }
    response: UiState | null
  }
  [IPC_CHANNELS.getFoldPreview]: {
    request: { repoPath: string; branchName: string }
    response: SquashPreview
  }
  [IPC_CHANNELS.foldIntoParent]: {
    request: { repoPath: string; branchName: string; commitMessage?: string }
    response: SquashResult
  }
  [IPC_CHANNELS.shipIt]: {
    request: {
      repoPath: string
      branchName: string
    }
    response: ShipItResponse
  }
  [IPC_CHANNELS.syncTrunk]: {
    request: { repoPath: string }
    response: SyncTrunkResponse
  }
  [IPC_CHANNELS.createBranch]: {
    request: { repoPath: string; branchName?: string; commitSha: string }
    response: UiState | null
  }
  [IPC_CHANNELS.renameBranch]: {
    request: { repoPath: string; oldBranchName: string; newBranchName: string }
    response: UiState | null
  }
  [IPC_CHANNELS.resumeRebaseQueue]: {
    request: { repoPath: string }
    response: RebaseOperationResponse
  }
  [IPC_CHANNELS.dismissRebaseQueue]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.getActiveWorktree]: {
    request: { repoPath: string }
    response: string | null
  }
  [IPC_CHANNELS.switchWorktree]: {
    request: { repoPath: string; worktreePath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.removeWorktree]: {
    request: { repoPath: string; worktreePath: string; force?: boolean }
    response: { success: boolean; error?: string; uiState?: UiState | null }
  }
  [IPC_CHANNELS.discardWorktreeChanges]: {
    request: { worktreePath: string }
    response: { success: boolean; error?: string }
  }
  [IPC_CHANNELS.checkoutWorktreeBranch]: {
    request: { worktreePath: string; branch: string }
    response: { success: boolean; error?: string }
  }
  [IPC_CHANNELS.openWorktreeInEditor]: {
    request: { worktreePath: string }
    response: { success: boolean; error?: string }
  }
  [IPC_CHANNELS.openWorktreeInTerminal]: {
    request: { worktreePath: string }
    response: { success: boolean; error?: string }
  }
  [IPC_CHANNELS.copyWorktreePath]: {
    request: { worktreePath: string }
    response: { success: boolean; error?: string }
  }
  [IPC_CHANNELS.createWorktree]: {
    request: { repoPath: string; branch: string }
    response: { success: boolean; error?: string; worktreePath?: string; uiState?: UiState | null }
  }
  [IPC_CHANNELS.cloneRepository]: {
    request: { url: string; targetPath: string; folderName?: string }
    response: { success: boolean; error?: string; repoPath?: string }
  }
  [IPC_CHANNELS.getLastClonePath]: {
    request: void
    response: string | null
  }
  [IPC_CHANNELS.readClipboardText]: {
    request: void
    response: string
  }
  [IPC_CHANNELS.checkCloneFolderName]: {
    request: { targetPath: string; folderName: string }
    response: { exists: boolean; suggestion?: string }
  }
  [IPC_CHANNELS.checkTargetPath]: {
    request: { targetPath: string }
    response: { valid: boolean; error?: string }
  }
}

/**
 * Type helper to extract request type for a channel
 */
export type IpcRequest<T extends keyof IpcContract> = IpcContract[T]['request']

/**
 * Type helper to extract response type for a channel
 */
export type IpcResponse<T extends keyof IpcContract> = IpcContract[T]['response']

/**
 * Type helper to extract request type using channel name string literal
 * Example: IpcRequestOf<'getRepo'>
 */
export type IpcRequestOf<T extends keyof IpcContract> = IpcRequest<T>

/**
 * Type helper to extract response type using channel name string literal
 * Example: IpcResponseOf<'getRepo'>
 */
export type IpcResponseOf<T extends keyof IpcContract> = IpcResponse<T>

/**
 * Type-safe IPC handler function signature
 */
export type IpcHandler<T extends keyof IpcContract> = (
  event: IpcMainInvokeEvent,
  ...args: IpcRequest<T> extends void ? [] : [IpcRequest<T>]
) => IpcResponse<T> | Promise<IpcResponse<T>>

export type IpcHandlerOf<T extends keyof IpcContract> = IpcHandler<T>
