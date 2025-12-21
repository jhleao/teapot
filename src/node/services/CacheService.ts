const MAX_COMMITS_PER_REPO = 5000
const MAX_REPOS = 10

export type CachedCommit = {
  sha: string
  message: string
  timeMs: number
  parentSha: string
}

export class RepoModelCache {
  private commits = new Map<string, CachedCommit>()
  private mergedBranchesMap = new Map<string, string[]>()
  private stats = { commitHits: 0, commitMisses: 0, mergedHits: 0, mergedMisses: 0 }

  getCommit(sha: string): CachedCommit | undefined {
    const cached = this.commits.get(sha)
    if (cached) {
      this.stats.commitHits++
    } else {
      this.stats.commitMisses++
    }
    return cached
  }

  setCommit(commit: CachedCommit): void {
    if (this.commits.size >= MAX_COMMITS_PER_REPO && !this.commits.has(commit.sha)) {
      this.evictOldestCommits(Math.floor(MAX_COMMITS_PER_REPO * 0.1))
    }
    this.commits.set(commit.sha, commit)
  }

  hasCommit(sha: string): boolean {
    return this.commits.has(sha)
  }

  get commitCount(): number {
    return this.commits.size
  }

  getMergedBranches(trunkHeadSha: string): string[] | null {
    const cached = this.mergedBranchesMap.get(trunkHeadSha)
    if (cached) {
      this.stats.mergedHits++
      return cached
    }
    this.stats.mergedMisses++
    return null
  }

  setMergedBranches(trunkHeadSha: string, names: string[]): void {
    if (this.mergedBranchesMap.size >= 5 && !this.mergedBranchesMap.has(trunkHeadSha)) {
      const oldest = this.mergedBranchesMap.keys().next().value
      if (oldest) {
        this.mergedBranchesMap.delete(oldest)
      }
    }
    this.mergedBranchesMap.set(trunkHeadSha, names)
  }

  invalidate(): void {
    this.mergedBranchesMap.clear()
  }

  clear(): void {
    this.commits.clear()
    this.mergedBranchesMap.clear()
    this.stats = { commitHits: 0, commitMisses: 0, mergedHits: 0, mergedMisses: 0 }
  }

  getStats() {
    const totalCommitAccess = this.stats.commitHits + this.stats.commitMisses
    const totalMergedAccess = this.stats.mergedHits + this.stats.mergedMisses
    return {
      commitCount: this.commits.size,
      commitHitRate: totalCommitAccess > 0 ? this.stats.commitHits / totalCommitAccess : 0,
      mergedHitRate: totalMergedAccess > 0 ? this.stats.mergedHits / totalMergedAccess : 0
    }
  }

  private evictOldestCommits(count: number): void {
    const entries = Array.from(this.commits.entries()).sort(
      (a, b) => (a[1].timeMs || 0) - (b[1].timeMs || 0)
    )
    for (let i = 0; i < count && i < entries.length; i++) {
      const entry = entries[i]
      if (entry) {
        this.commits.delete(entry[0])
      }
    }
  }
}

const caches = new Map<string, RepoModelCache>()

export function getRepoCache(repoPath: string): RepoModelCache {
  let cache = caches.get(repoPath)
  if (!cache) {
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

export function invalidateRepoCache(repoPath: string): void {
  const cache = caches.get(repoPath)
  if (cache) {
    cache.invalidate()
  }
}

export function clearRepoCache(repoPath: string): void {
  caches.delete(repoPath)
}

export function clearAllRepoCaches(): void {
  caches.clear()
}
