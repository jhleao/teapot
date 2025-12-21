import type { Branch, Commit } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { TrunkResolver } from '../TrunkResolver'

describe('TrunkResolver.getTrunkHeadSha', () => {
  it('returns the headSha of the remote trunk branch when no commits provided', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'trunk-sha-123', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('trunk-sha-123')
  })

  it('falls back to remote trunk when no commits provided (fallback behavior)', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]

    // Without commits, falls back to remote (source of truth for stacked diffs)
    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('remote-sha')
  })

  it('uses more recent trunk when commits are provided - remote is newer', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]
    const commits: Commit[] = [
      createCommit({ sha: 'remote-sha', timeMs: 2000 }), // newer
      createCommit({ sha: 'local-sha', timeMs: 1000 }) // older
    ]

    // After Ship it: origin/main moves forward, so it has newer timestamp
    expect(TrunkResolver.getTrunkHeadSha(branches, commits)).toBe('remote-sha')
  })

  it('uses more recent trunk when commits are provided - local is newer', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]
    const commits: Commit[] = [
      createCommit({ sha: 'remote-sha', timeMs: 1000 }), // older
      createCommit({ sha: 'local-sha', timeMs: 2000 }) // newer (local offline work)
    ]

    // Offline scenario: local main has newer commits
    expect(TrunkResolver.getTrunkHeadSha(branches, commits)).toBe('local-sha')
  })

  it('uses local trunk when timestamps are equal', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]
    const commits: Commit[] = [
      createCommit({ sha: 'remote-sha', timeMs: 1000 }),
      createCommit({ sha: 'local-sha', timeMs: 1000 }) // same timestamp
    ]

    // When equal, prefer local (they point to the same logical commit)
    expect(TrunkResolver.getTrunkHeadSha(branches, commits)).toBe('local-sha')
  })

  it('falls back to local trunk when no remote trunk exists', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false }),
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('local-sha')
  })

  it('returns remote trunk when only remote exists', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('remote-sha')
  })

  it('returns empty string when no trunk branch exists', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('')
  })

  it('returns empty string when branches array is empty', () => {
    expect(TrunkResolver.getTrunkHeadSha([])).toBe('')
  })

  it('returns empty string when trunk has no headSha', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'main', headSha: '', isTrunk: true, isRemote: false })
    ]

    expect(TrunkResolver.getTrunkHeadSha(branches)).toBe('')
  })

  it('falls back to remote when commits are provided but trunk commits not found', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]
    const commits: Commit[] = [
      createCommit({ sha: 'other-sha', timeMs: 1000 }) // neither trunk commit in array
    ]

    // Falls back to remote when can't compare timestamps
    expect(TrunkResolver.getTrunkHeadSha(branches, commits)).toBe('remote-sha')
  })
})

function createBranch(overrides: {
  ref: string
  headSha: string
  isTrunk: boolean
  isRemote: boolean
}): Branch {
  return {
    ref: overrides.ref,
    headSha: overrides.headSha,
    isTrunk: overrides.isTrunk,
    isRemote: overrides.isRemote
  }
}

function createCommit(overrides: { sha: string; timeMs: number }): Commit {
  return {
    sha: overrides.sha,
    message: 'test commit',
    timeMs: overrides.timeMs,
    parentSha: '',
    childrenSha: []
  }
}
