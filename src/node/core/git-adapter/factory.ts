/**
 * Git Adapter Factory
 *
 * Provides a centralized way to create and access Git adapter instances.
 * Supports feature flags for gradual rollout of new Git backends.
 */

import { log } from '@shared/logger'
import type { GitAdapter } from './interface'
import { IsomorphicGitAdapter } from './isomorphic-git-adapter'
import { SimpleGitAdapter } from './simple-git-adapter'

/**
 * Supported Git adapter types
 */
export type GitAdapterType = 'isomorphic-git' | 'simple-git'

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
let cachedAdapterType: GitAdapterType | null = null

/**
 * Create a Git adapter instance
 *
 * @param config - Adapter configuration
 * @returns Git adapter instance
 */
export function createGitAdapter(config: GitAdapterConfig = {}): GitAdapter {
  const adapterType = getAdapterType(config)

  if (config.verbose) {
    log.info(`[GitAdapter] Creating adapter: ${adapterType}`)
  }

  switch (adapterType) {
    case 'simple-git':
      return new SimpleGitAdapter()

    case 'isomorphic-git':
    default:
      return new IsomorphicGitAdapter()
  }
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
  const adapterType = getAdapterType(config)

  // Return cached instance if type hasn't changed
  if (cachedAdapter && cachedAdapterType === adapterType) {
    return cachedAdapter
  }

  // Create new instance
  cachedAdapter = createGitAdapter(config)
  cachedAdapterType = adapterType

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
  cachedAdapterType = null
}

/**
 * Determine which adapter type to use
 *
 * Priority:
 * 1. Explicit config.type
 * 2. Environment variable GIT_ADAPTER
 * 3. Default to isomorphic-git (for backward compatibility)
 *
 * @param config - Adapter configuration
 * @returns Adapter type to use
 */
function getAdapterType(config: GitAdapterConfig): GitAdapterType {
  // Explicit config takes precedence
  if (config.type) {
    return config.type
  }

  // Check environment variable
  const envAdapter = process.env.GIT_ADAPTER?.toLowerCase()
  if (envAdapter === 'simple-git' || envAdapter === 'isomorphic-git') {
    return envAdapter as GitAdapterType
  }

  // Default to isomorphic-git for backward compatibility
  return 'isomorphic-git'
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
    type: cachedAdapterType ?? 'isomorphic-git',
    supportsMergeBase: typeof adapter.mergeBase === 'function',
    supportsRebase: typeof adapter.rebase === 'function',
    supportsCherryPick: typeof adapter.cherryPick === 'function'
  }
}
