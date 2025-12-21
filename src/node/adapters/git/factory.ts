/**
 * Git Adapter Factory
 *
 * Provides a centralized way to create and access Git adapter instances.
 */

import { log } from '@shared/logger'
import type { GitAdapter } from './interface'
import { SimpleGitAdapter } from './SimpleGitAdapter'

/**
 * Supported Git adapter types
 */
export type GitAdapterType = 'simple-git'

/**
 * Configuration for adapter creation
 */
export interface GitAdapterConfig {
  /**
   * Which adapter to use
   * Can be set via environment variable GIT_ADAPTER
   */
  type?: GitAdapterType

  /**
   * Whether to log adapter creation
   */
  verbose?: boolean
}

/**
 * Singleton adapter instance
 * Cached to avoid recreating adapters on every operation
 */
let cachedAdapter: GitAdapter | null = null

/**
 * Create a Git adapter instance
 *
 * @param config - Adapter configuration
 * @returns Git adapter instance
 */
export function createGitAdapter(config: GitAdapterConfig = {}): GitAdapter {
  if (config.verbose) {
    log.info(`[GitAdapter] Creating adapter: simple-git`)
  }

  return new SimpleGitAdapter()
}

/**
 * Get the singleton Git adapter instance
 *
 * This is the recommended way to access the adapter in most code.
 * The instance is cached and reused across calls.
 *
 * @param config - Optional configuration (only used on first call)
 * @returns Cached Git adapter instance
 */
export function getGitAdapter(config: GitAdapterConfig = {}): GitAdapter {
  // Return cached instance if available
  if (cachedAdapter) {
    return cachedAdapter
  }

  // Create new instance
  cachedAdapter = createGitAdapter(config)

  if (config.verbose) {
    log.info(`[GitAdapter] Using adapter: ${cachedAdapter.name}`)
  }

  return cachedAdapter
}

/**
 * Reset the cached adapter instance
 *
 * Useful for testing or when switching adapters at runtime
 */
export function resetGitAdapter(): void {
  cachedAdapter = null
}

/**
 * Check if the current adapter supports a specific feature
 *
 * @param feature - Feature name (method name on GitAdapter)
 * @returns Whether the feature is supported
 */
export function supportsFeature(feature: keyof GitAdapter): boolean {
  const adapter = getGitAdapter()
  return typeof adapter[feature] === 'function'
}

/**
 * Get information about the current adapter
 *
 * @returns Adapter metadata
 */
export function getAdapterInfo(): {
  name: string
  type: GitAdapterType
  supportsMergeBase: boolean
  supportsRebase: boolean
  supportsCherryPick: boolean
} {
  const adapter = getGitAdapter()

  return {
    name: adapter.name,
    type: 'simple-git',
    supportsMergeBase: typeof adapter.mergeBase === 'function',
    supportsRebase: typeof adapter.rebase === 'function',
    supportsCherryPick: typeof adapter.cherryPick === 'function'
  }
}
