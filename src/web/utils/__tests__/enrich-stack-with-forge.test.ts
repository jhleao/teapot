import type { UiBranch, UiStack } from '@shared/types'
import type { ForgePullRequest, GitForgeState } from '@shared/types/git-forge'
import { describe, expect, it } from 'vitest'
import { enrichStackWithForge } from '../enrich-stack-with-forge'

/** Helper to create a UiBranch with computed permissions */
const createBranch = (overrides: Partial<UiBranch> = {}): UiBranch => {
  const isCurrent = overrides.isCurrent ?? false
  const isRemote = overrides.isRemote ?? false
  const isTrunk = overrides.isTrunk ?? false

  return {
    name: 'feature-branch',
    isCurrent,
    isRemote,
    isTrunk,
    canRename: !isRemote && !isTrunk,
    canFold: !isRemote && !isTrunk,
    canCreateWorktree: !isRemote && !isTrunk,
    ...overrides
  }
}

describe('enrichStackWithForge', () => {
  const createStack = (overrides: Partial<UiStack> = {}): UiStack => ({
    isTrunk: false,
    canRebaseToTrunk: false,
    commits: [
      {
        sha: 'commit-1',
        name: 'Test commit',
        timestampMs: Date.now(),
        isCurrent: true,
        rebaseStatus: null,
        spinoffs: [],
        branches: [createBranch({ isCurrent: true })]
      }
    ],
    ...overrides
  })

  const createForgeState = (overrides: Partial<GitForgeState> = {}): GitForgeState => ({
    pullRequests: [],
    ...overrides
  })

  const createPR = (overrides: Partial<ForgePullRequest> = {}): ForgePullRequest => ({
    number: 42,
    title: 'My PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    headRefName: 'feature-branch',
    baseRefName: 'main',
    headSha: 'commit-1',
    isMergeable: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides
  })

  it('should return null if stack is null', () => {
    const result = enrichStackWithForge(null, createForgeState())
    expect(result).toBeNull()
  })

  it('should return original stack if forgeState is null', () => {
    const stack = createStack()
    const result = enrichStackWithForge(stack, null)
    expect(result).toBe(stack)
  })

  it('should return original stack if forgeState has no PRs', () => {
    const stack = createStack()
    const result = enrichStackWithForge(stack, createForgeState())
    expect(result).toBe(stack)
  })

  it('should enrich branch with PR data when PR exists for branch', () => {
    const stack = createStack()
    const forgeState = createForgeState({
      pullRequests: [createPR()]
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].pullRequest).toEqual({
      number: 42,
      title: 'My PR',
      url: 'https://github.com/owner/repo/pull/42',
      state: 'open',
      isInSync: true,
      isMergeable: true
    })
  })

  it('should set isInSync to false when PR headSha differs from commit sha', () => {
    const stack = createStack()
    const forgeState = createForgeState({
      pullRequests: [createPR({ headSha: 'different-sha' })]
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].pullRequest?.isInSync).toBe(false)
  })

  it('should set isMerged to true when PR state is merged', () => {
    const stack = createStack()
    const forgeState = createForgeState({
      pullRequests: [createPR({ state: 'merged', isMergeable: false })]
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].isMerged).toBe(true)
  })

  it('should set hasStaleTarget when PR targets a merged branch', () => {
    const stack = createStack()
    const forgeState = createForgeState({
      pullRequests: [createPR({ baseRefName: 'old-feature' })],
      mergedBranchNames: ['old-feature']
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].hasStaleTarget).toBe(true)
  })

  it('should handle remote branches by normalizing name', () => {
    const stack = createStack({
      commits: [
        {
          sha: 'commit-1',
          name: 'Test commit',
          timestampMs: Date.now(),
          isCurrent: false,
          rebaseStatus: null,
          spinoffs: [],
          branches: [createBranch({ name: 'origin/feature-branch', isRemote: true })]
        }
      ]
    })
    const forgeState = createForgeState({
      pullRequests: [createPR()]
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].pullRequest?.number).toBe(42)
  })

  it('should enrich spinoffs recursively', () => {
    const stack = createStack({
      commits: [
        {
          sha: 'parent-commit',
          name: 'Parent',
          timestampMs: Date.now(),
          isCurrent: false,
          rebaseStatus: null,
          branches: [],
          spinoffs: [
            {
              isTrunk: false,
              canRebaseToTrunk: false,
              commits: [
                {
                  sha: 'child-commit',
                  name: 'Child',
                  timestampMs: Date.now(),
                  isCurrent: true,
                  rebaseStatus: null,
                  spinoffs: [],
                  branches: [createBranch({ name: 'child-branch', isCurrent: true })]
                }
              ]
            }
          ]
        }
      ]
    })
    const forgeState = createForgeState({
      pullRequests: [
        createPR({
          number: 99,
          title: 'Child PR',
          url: 'https://github.com/owner/repo/pull/99',
          headRefName: 'child-branch',
          headSha: 'child-commit'
        })
      ]
    })

    const result = enrichStackWithForge(stack, forgeState)

    const spinoff = result?.commits[0].spinoffs[0]
    expect(spinoff?.commits[0].branches[0].pullRequest?.number).toBe(99)
  })

  it('should skip branches that already have PR data', () => {
    const existingPr = {
      number: 1,
      title: 'Existing',
      url: 'https://github.com/owner/repo/pull/1',
      state: 'open' as const,
      isInSync: true,
      isMergeable: false
    }
    const stack = createStack({
      commits: [
        {
          sha: 'commit-1',
          name: 'Test commit',
          timestampMs: Date.now(),
          isCurrent: true,
          rebaseStatus: null,
          spinoffs: [],
          branches: [createBranch({ isCurrent: true, pullRequest: existingPr })]
        }
      ]
    })
    const forgeState = createForgeState({
      pullRequests: [createPR({ title: 'New PR' })]
    })

    const result = enrichStackWithForge(stack, forgeState)

    // Should keep existing PR, not replace with forge state
    expect(result?.commits[0].branches[0].pullRequest).toEqual(existingPr)
  })

  it('should set isMerged from mergedBranchNames when no PR exists', () => {
    const stack = createStack()
    // Need at least one PR for forgeState to be processed
    const forgeState = createForgeState({
      pullRequests: [
        createPR({
          number: 99,
          title: 'Other PR',
          url: 'https://github.com/owner/repo/pull/99',
          headRefName: 'other-branch',
          headSha: 'other-sha'
        })
      ],
      mergedBranchNames: ['feature-branch']
    })

    const result = enrichStackWithForge(stack, forgeState)

    expect(result?.commits[0].branches[0].isMerged).toBe(true)
  })
})
