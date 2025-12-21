/**
 * Forge Adapter Module
 *
 * Provides adapters for interacting with git forges (GitHub, GitLab, etc.)
 *
 * Usage:
 * ```typescript
 * import { GitForgeClient, GitHubAdapter } from '@node/adapters/forge'
 *
 * const adapter = new GitHubAdapter(pat, owner, repo)
 * const client = new GitForgeClient(adapter)
 * const state = await client.getStateWithStatus()
 * ```
 */

// Main client
export { GitForgeClient } from './GitForgeClient'
export type {
  ForgeStateResult,
  ForgeStatus,
  GitForgeAdapter,
  GitForgeState
} from './GitForgeClient'

// Adapter implementations
export { GitHubAdapter } from './github/GitHubAdapter'
