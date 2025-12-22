/**
 * Repository Model Cache
 *
 * Lightweight in-memory cache for repository data to improve performance
 * on repeated getUiState() calls.
 *
 * Caching strategy:
 * - Commit metadata: Cached forever (commits are immutable by SHA)
 * - Merged branches: Cached per trunk HEAD SHA (invalidates when trunk advances)
 *
 * Invalidation:
 * - File system changes trigger invalidate() via GitWatcher
 * - Memory is bounded by evicting oldest commits when limits are reached
 */

// Memory limits
const MAX_COMMITS_PER_REPO = 5000
const MAX_REPOS = 10

/**
 * Cached commit data (immutable fields only).
 * childrenSha is NOT cached - it's computed dynamically from parent relationships.
 */
export type CachedCommit = {
  sha: string
  message: string
  timeMs: number
  parentSha: string
}

/**
 * Cache for a single repository's model data.
 */
export class RepoModelCache {
  // Commit cache - keyed by SHA, never expires (commits are immutable)
  private commits = new Map<string, CachedCommit>()

  // Merged branches cache - keyed by trunk HEAD SHA
  // When trunk advances, old entries become stale but harmless
  private mergedBranchesMap = new Map<string, string[]>()

  // Stats for debugging/monitoring
  private stats = {
    commitHits: 0,
    commitMisses: 0,
    mergedHits: 0,
    mergedMisses: 0
  }

  // --- Commit Cache ---

  /**
   * Get a cached commit by SHA.
   */
  getCommit(sha: string): CachedCommit | undefined {
    const cached = this.commits.get(sha)
    if (cached) {
      this.stats.commitHits++
    } else {
      this.stats.commitMisses++
    }
    return cached
  }

  /**
   * Cache a commit. Evicts oldest commits if memory limit is reached.
   */
  setCommit(commit: CachedCommit): void {
    if (this.commits.size >= MAX_COMMITS_PER_REPO && !this.commits.has(commit.sha)) {
      this.evictOldestCommits(Math.floor(MAX_COMMITS_PER_REPO * 0.1)) // Evict 10%
    }
    this.commits.set(commit.sha, commit)
  }

  /**
   * Check if a commit is cached without counting as a hit/miss.
   */
  hasCommit(sha: string): boolean {
    return this.commits.has(sha)
  }

  /**
   * Get the number of cached commits.
   */
  get commitCount(): number {
    return this.commits.size
  }

  // --- Merged Branches Cache ---

  /**
   * Get cached merged branch names for a given trunk HEAD.
   * Returns null if not cached (caller should compute and cache).
   */
  getMergedBranches(trunkHeadSha: string): string[] | null {
    const cached = this.mergedBranchesMap.get(trunkHeadSha)
    if (cached) {
      this.stats.mergedHits++
      return cached
    }
    this.stats.mergedMisses++
    return null
  }

  /**
   * Cache merged branch names for a given trunk HEAD.
   * Only keeps the last few trunk versions to prevent unbounded growth.
   */
  setMergedBranches(trunkHeadSha: string, names: string[]): void {
    // Keep only the most recent 5 trunk versions
    if (this.mergedBranchesMap.size >= 5 && !this.mergedBranchesMap.has(trunkHeadSha)) {
      const oldest = this.mergedBranchesMap.keys().next().value
      if (oldest) {
        this.mergedBranchesMap.delete(oldest)
      }
    }
    this.mergedBranchesMap.set(trunkHeadSha, names)
  }

  // --- Invalidation ---

  /**
   * Invalidate caches that depend on branch state.
   * Called when file system changes are detected.
   * Note: Commit cache is NOT cleared (commits are immutable).
   */
  invalidate(): void {
    this.mergedBranchesMap.clear()
  }

  /**
   * Clear all cached data for this repo.
   */
  clear(): void {
    this.commits.clear()
    this.mergedBranchesMap.clear()
    this.stats = { commitHits: 0, commitMisses: 0, mergedHits: 0, mergedMisses: 0 }
  }

  // --- Stats ---

  /**
   * Get cache statistics for debugging.
   */
  getStats(): {
    commitCount: number
    commitHitRate: number
    mergedHitRate: number
  } {
    const totalCommitAccess = this.stats.commitHits + this.stats.commitMisses
    const totalMergedAccess = this.stats.mergedHits + this.stats.mergedMisses
    return {
      commitCount: this.commits.size,
      commitHitRate: totalCommitAccess > 0 ? this.stats.commitHits / totalCommitAccess : 0,
      mergedHitRate: totalMergedAccess > 0 ? this.stats.mergedHits / totalMergedAccess : 0
    }
  }

  // --- Private ---

  /**
   * Evict oldest commits by timestamp.
   */
  private evictOldestCommits(count: number): void {
    // Sort commits by timestamp (oldest first)
    const entries = Array.from(this.commits.entries()).sort(
      (a, b) => (a[1].timeMs || 0) - (b[1].timeMs || 0)
    )

    // Delete the oldest entries
    for (let i = 0; i < count && i < entries.length; i++) {
      const entry = entries[i]
      if (entry) {
        this.commits.delete(entry[0])
      }
    }
  }
}

// --- Global Cache Registry ---

const caches = new Map<string, RepoModelCache>()

/**
 * Get or create a cache for a repository.
 */
export function getRepoCache(repoPath: string): RepoModelCache {
  let cache = caches.get(repoPath)
  if (!cache) {
    // Evict oldest repo cache if at limit
    if (caches.size >= MAX_REPOS) {
      const oldest = caches.keys().next().value
      if (oldest) {
        caches.delete(oldest)
      }
    }
    cache = new RepoModelCache()
    caches.set(repoPath, cache)
  }
  return cache
}

/**
 * Invalidate branch-dependent caches for a repository.
 * Called by GitWatcher when file system changes are detected.
 */
export function invalidateRepoCache(repoPath: string): void {
  const cache = caches.get(repoPath)
  if (cache) {
    cache.invalidate()
  }
}

/**
 * Clear all cached data for a repository.
 */
export function clearRepoCache(repoPath: string): void {
  caches.delete(repoPath)
}

/**
 * Clear all repo caches (for testing).
 */
export function clearAllRepoCaches(): void {
  caches.clear()
}
