/**
 * Node-specific constants for the backend.
 * Re-exports shared constants and adds backend-specific values.
 */

// Re-export trunk branches from shared types for convenience
export { TRUNK_BRANCHES, isTrunk, type TrunkBranchName } from '@shared/types/repo'

/**
 * Common remote names in order of preference.
 */
export const REMOTE_PREFIXES = ['origin', 'upstream', 'fork'] as const
export type RemotePrefix = (typeof REMOTE_PREFIXES)[number]

/**
 * Maximum commits to load for any single branch (safety limit).
 * Prevents crashes from pathological cases like circular history.
 */
export const MAX_COMMITS_PER_BRANCH = 1000

/**
 * Maximum commits to cache per repository.
 */
export const MAX_COMMITS_PER_REPO_CACHE = 5000

/**
 * Default trunk depth for limiting trunk history loading.
 */
export const DEFAULT_TRUNK_DEPTH = 200
