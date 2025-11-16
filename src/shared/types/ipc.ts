import type { UiState } from './ui'

/**
 * IPC Channel names - single source of truth for channel identifiers
 */
export const IPC_CHANNELS = {
  getRepo: 'getRepo',
  submitRebaseIntent: 'submitRebaseIntent'
} as const

/**
 * IPC Request/Response type mappings
 * Each channel maps to: [RequestType, ResponseType]
 */
export interface IpcContract {
  [IPC_CHANNELS.getRepo]: {
    request: void
    response: UiState
  }
  [IPC_CHANNELS.submitRebaseIntent]: {
    request: { headSha: string; baseSha: string }
    response: UiState
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
  ...args: IpcRequest<T> extends void ? [] : [IpcRequest<T>]
) => IpcResponse<T> | Promise<IpcResponse<T>>

export type IpcHandlerOf<T extends keyof IpcContract> = IpcHandler<T>
