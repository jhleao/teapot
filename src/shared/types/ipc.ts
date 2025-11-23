import { IpcMainInvokeEvent } from 'electron'
import type { UiState } from './ui'

/**
 * IPC Channel names - single source of truth for channel identifiers
 */
export const IPC_CHANNELS = {
  getRepo: 'getRepo',
  submitRebaseIntent: 'submitRebaseIntent',
  confirmRebaseIntent: 'confirmRebaseIntent',
  cancelRebaseIntent: 'cancelRebaseIntent',
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
  deleteBranch: 'deleteBranch'
} as const

export const IPC_EVENTS = {
  repoChange: 'repoChange'
} as const

/**
 * IPC Request/Response type mappings
 * Each channel maps to: [RequestType, ResponseType]
 */
export interface IpcContract {
  [IPC_CHANNELS.getRepo]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.submitRebaseIntent]: {
    request: { repoPath: string; headSha: string; baseSha: string }
    response: UiState | null
  }
  [IPC_CHANNELS.confirmRebaseIntent]: {
    request: { repoPath: string }
    response: UiState | null
  }
  [IPC_CHANNELS.cancelRebaseIntent]: {
    request: { repoPath: string }
    response: UiState | null
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
    response: Array<{ path: string; isSelected: boolean }>
  }
  [IPC_CHANNELS.selectLocalRepo]: {
    request: { path: string }
    response: Array<{ path: string; isSelected: boolean }>
  }
  [IPC_CHANNELS.addLocalRepo]: {
    request: { path: string }
    response: Array<{ path: string; isSelected: boolean }>
  }
  [IPC_CHANNELS.removeLocalRepo]: {
    request: { path: string }
    response: Array<{ path: string; isSelected: boolean }>
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
    response: UiState | null
  }
  [IPC_CHANNELS.deleteBranch]: {
    request: { repoPath: string; branchName: string }
    response: UiState | null
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
