import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildUiStack } from '../build-ui-state.js'

describe('buildUiState', () => {
  it('returns null when Repo has no commits', () => {
    const repo = createRepo()

    expect(buildUiStack(repo)).toBeNull()
  })

  it('creates a trunk stack with spinoffs and branch annotations', () => {
    const root = createCommit({
      sha: '0000001',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['0000002', '0000003']
    })
    const trunkCommit = createCommit({
      sha: '0000002',
      message: 'main update',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: '0000003',
      message: 'feature base',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['0000004']
    })
    const featureTip = createCommit({
      sha: '0000004',
      message: 'feature tip',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkCommit, featureBase, featureTip],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkCommit.sha
        }),
        createBranch({
          ref: 'feature/topic',
          isTrunk: false,
          isRemote: false,
          headSha: featureTip.sha
        })
      ],
      workingTreeStatus: createWorkingTreeStatus({
        currentBranch: 'feature/topic',
        currentCommitSha: featureTip.sha
      })
    })

    const trunkStack = expectTrunkStack(repo)
    expect(trunkStack.isTrunk).toBe(true)
    expect(trunkStack.commits.map((commit) => commit.sha)).toEqual([root.sha, trunkCommit.sha])

    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected at least one commit in the trunk stack')
    }
    expect(rootUiCommit.spinoffs).toHaveLength(1)
    const featureStack = rootUiCommit.spinoffs[0]
    if (!featureStack) {
      throw new Error('expected a spinoff stack to be created')
    }
    expect(featureStack.isTrunk).toBe(false)
    expect(featureStack.commits.map((commit) => commit.sha)).toEqual([
      featureBase.sha,
      featureTip.sha
    ])

    const trunkTip = trunkStack.commits[trunkStack.commits.length - 1]
    if (!trunkTip) {
      throw new Error('expected a tip commit in the trunk stack')
    }
    expect(trunkTip.branches).toContainEqual({ name: 'main', isCurrent: false })

    const featureTipCommit = featureStack.commits[featureStack.commits.length - 1]
    if (!featureTipCommit) {
      throw new Error('expected a tip commit for the feature stack')
    }
    expect(featureTipCommit.branches).toContainEqual({
      name: 'feature/topic',
      isCurrent: true
    })
  })

  it('returns null when the detected trunk branch has no head commit', () => {
    const orphanCommit = createCommit({
      sha: 'deadbeef',
      message: 'orphan',
      timeMs: 1,
      parentSha: '',
      childrenSha: []
    })

    const repo = createRepo({
      commits: [orphanCommit],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: ''
        }),
        createBranch({
          ref: 'feature/missing-trunk',
          isTrunk: false,
          isRemote: false,
          headSha: orphanCommit.sha
        })
      ]
    })

    expect(buildUiStack(repo)).toBeNull()
  })

  it('uses canonical remote branches as the trunk when no local trunk exists', () => {
    const root = createCommit({
      sha: 'root-sha',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature-base']
    })
    const mainTip = createCommit({
      sha: 'main-tip',
      message: 'remote trunk',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: 'feature-base',
      message: 'feature start',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['feature-tip']
    })
    const featureTip = createCommit({
      sha: 'feature-tip',
      message: 'feature end',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, mainTip, featureBase, featureTip],
      branches: [
        createBranch({
          ref: 'origin/main',
          isTrunk: false,
          isRemote: true,
          headSha: mainTip.sha
        }),
        createBranch({
          ref: 'feature/topic',
          isTrunk: false,
          isRemote: false,
          headSha: featureTip.sha
        })
      ],
      workingTreeStatus: createWorkingTreeStatus({
        currentBranch: 'feature/topic',
        currentCommitSha: featureTip.sha
      })
    })

    const trunkStack = expectTrunkStack(repo)
    expect(trunkStack.commits.map((commit) => commit.sha)).toEqual([root.sha, mainTip.sha])

    const remoteTrunkTip = trunkStack.commits[trunkStack.commits.length - 1]
    if (!remoteTrunkTip) {
      throw new Error('expected remote trunk tip')
    }
    expect(remoteTrunkTip.branches).toContainEqual({ name: 'origin/main', isCurrent: false })

    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    expect(rootUiCommit.spinoffs).toHaveLength(1)
    const featureStack = rootUiCommit.spinoffs[0]
    if (!featureStack) {
      throw new Error('expected feature stack')
    }
    const featureTipCommit = featureStack.commits[featureStack.commits.length - 1]
    if (!featureTipCommit) {
      throw new Error('expected feature tip')
    }
    expect(featureTipCommit.branches).toContainEqual({
      name: 'feature/topic',
      isCurrent: true
    })
  })

  it('orders spinoff stacks and their commits deterministically by timestamp', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['trunk-1', 'feature-a', 'feature-b']
    })
    const trunkOne = createCommit({
      sha: 'trunk-1',
      message: 'trunk one',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: ['trunk-2']
    })
    const trunkTwo = createCommit({
      sha: 'trunk-2',
      message: 'trunk two',
      timeMs: 3,
      parentSha: trunkOne.sha,
      childrenSha: []
    })
    const featureA = createCommit({
      sha: 'feature-a',
      message: 'feature a base',
      timeMs: 10,
      parentSha: root.sha,
      childrenSha: ['feature-a-tip']
    })
    const featureATip = createCommit({
      sha: 'feature-a-tip',
      message: 'feature a tip',
      timeMs: 11,
      parentSha: featureA.sha,
      childrenSha: []
    })
    const featureB = createCommit({
      sha: 'feature-b',
      message: 'feature b base',
      timeMs: 20,
      parentSha: root.sha,
      childrenSha: ['feature-b-tip']
    })
    const featureBtip = createCommit({
      sha: 'feature-b-tip',
      message: 'feature b tip',
      timeMs: 21,
      parentSha: featureB.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkOne, trunkTwo, featureA, featureATip, featureB, featureBtip],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTwo.sha
        }),
        createBranch({
          ref: 'feature/a',
          isTrunk: false,
          isRemote: false,
          headSha: featureATip.sha
        }),
        createBranch({
          ref: 'feature/b',
          isTrunk: false,
          isRemote: false,
          headSha: featureBtip.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root ui commit')
    }
    const spinoffOrder = rootUiCommit.spinoffs.map((stack) => stack.commits[0]?.sha)
    expect(spinoffOrder).toEqual([featureA.sha, featureB.sha])

    const featureAStack = rootUiCommit.spinoffs[0]
    const featureBStack = rootUiCommit.spinoffs[1]
    if (!featureAStack || !featureBStack) {
      throw new Error('expected both feature stacks')
    }
    expect(featureAStack.commits.map((commit) => commit.sha)).toEqual([
      featureA.sha,
      featureATip.sha
    ])
    expect(featureBStack.commits.map((commit) => commit.sha)).toEqual([
      featureB.sha,
      featureBtip.sha
    ])
  })

  it('continues non-trunk stacks on the earliest child and spawns additional spinoffs', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature-base']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: 'feature-base',
      message: 'feature base',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['feature-early', 'feature-late']
    })
    const featureEarly = createCommit({
      sha: 'feature-early',
      message: 'feature early child',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })
    const featureLate = createCommit({
      sha: 'feature-late',
      message: 'feature late child',
      timeMs: 10,
      parentSha: featureBase.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip, featureBase, featureEarly, featureLate],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        }),
        createBranch({
          ref: 'feature/topic',
          isTrunk: false,
          isRemote: false,
          headSha: featureEarly.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    const [featureStack] = rootUiCommit.spinoffs
    if (!featureStack) {
      throw new Error('expected feature stack')
    }
    expect(featureStack.commits.map((commit) => commit.sha)).toEqual([
      featureBase.sha,
      featureEarly.sha
    ])

    const featureContinuation = featureStack.commits[0]
    if (!featureContinuation) {
      throw new Error('expected feature base commit')
    }
    expect(featureContinuation.spinoffs).toHaveLength(1)
    const nestedStack = featureContinuation.spinoffs[0]
    expect(nestedStack?.commits.map((commit) => commit.sha)).toEqual([featureLate.sha])
  })

  it('prevents duplicate membership when spinoffs converge to the same commit', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature-base']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: 'feature-base',
      message: 'feature base',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['feature-a', 'feature-b']
    })
    const featureA = createCommit({
      sha: 'feature-a',
      message: 'feature a',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: ['shared-tip']
    })
    const featureB = createCommit({
      sha: 'feature-b',
      message: 'feature b',
      timeMs: 5,
      parentSha: featureBase.sha,
      childrenSha: ['shared-tip']
    })
    const sharedTip = createCommit({
      sha: 'shared-tip',
      message: 'shared tip',
      timeMs: 6,
      parentSha: featureA.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip, featureBase, featureA, featureB, sharedTip],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        }),
        createBranch({
          ref: 'feature/a',
          isTrunk: false,
          isRemote: false,
          headSha: sharedTip.sha
        }),
        createBranch({
          ref: 'feature/b',
          isTrunk: false,
          isRemote: false,
          headSha: featureB.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    const featureStack = rootUiCommit.spinoffs[0]
    if (!featureStack) {
      throw new Error('expected feature stack')
    }
    expect(featureStack.commits.map((commit) => commit.sha)).toEqual([
      featureBase.sha,
      featureA.sha
    ])
    const nestedFromBase = featureStack.commits[0]?.spinoffs[0]
    if (!nestedFromBase) {
      throw new Error('expected nested spinoff')
    }
    expect(nestedFromBase.commits.map((commit) => commit.sha)).toEqual([
      featureB.sha,
      sharedTip.sha
    ])
  })

  it('ignores unknown child shas when building spinoffs', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature-base']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: 'feature-base',
      message: 'feature base',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['known-child', 'missing-child']
    })
    const featureChild = createCommit({
      sha: 'known-child',
      message: 'known child',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip, featureBase, featureChild],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    const featureStack = rootUiCommit.spinoffs[0]
    if (!featureStack) {
      throw new Error('expected feature stack')
    }
    expect(featureStack.commits.map((commit) => commit.sha)).toEqual([
      featureBase.sha,
      featureChild.sha
    ])
  })

  it('excludes trunk commits when enumerating children for spinoffs', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: ['main-tip-2']
    })
    const trunkTip2 = createCommit({
      sha: 'main-tip-2',
      message: 'main tip 2',
      timeMs: 3,
      parentSha: trunkTip.sha,
      childrenSha: []
    })
    const feature = createCommit({
      sha: 'feature',
      message: 'feature',
      timeMs: 4,
      parentSha: root.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip, trunkTip2, feature],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip2.sha
        }),
        createBranch({
          ref: 'feature/topic',
          isTrunk: false,
          isRemote: false,
          headSha: feature.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    expect(rootUiCommit.spinoffs.map((stack) => stack.commits[0]?.sha)).toEqual([feature.sha])
  })

  it('orders sibling spinoffs deterministically when timestamps match', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip', 'feature-base']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })
    const featureBase = createCommit({
      sha: 'feature-base',
      message: 'feature base',
      timeMs: 3,
      parentSha: root.sha,
      childrenSha: ['feature-a', 'feature-b', 'feature-c']
    })
    const featureA = createCommit({
      sha: 'feature-a',
      message: 'feature A',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })
    const featureB = createCommit({
      sha: 'feature-b',
      message: 'feature B',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })
    const featureC = createCommit({
      sha: 'feature-c',
      message: 'feature C',
      timeMs: 4,
      parentSha: featureBase.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip, featureBase, featureA, featureB, featureC],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const rootUiCommit = trunkStack.commits[0]
    if (!rootUiCommit) {
      throw new Error('expected root commit')
    }
    const featureStack = rootUiCommit.spinoffs[0]
    if (!featureStack) {
      throw new Error('expected feature stack')
    }
    const nestedStacks = featureStack.commits[0]?.spinoffs ?? []
    expect(nestedStacks.map((stack) => stack.commits[0]?.sha)).toEqual(['feature-b', 'feature-c'])
  })

  it('creates deeply nested spinoffs while retaining branch annotations', () => {
    const trunkStart = createCommit({
      sha: 'main-0',
      message: 'main 0',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-1', 'feature-1-base']
    })
    const trunkTip = createCommit({
      sha: 'main-1',
      message: 'main 1',
      timeMs: 2,
      parentSha: trunkStart.sha,
      childrenSha: []
    })
    const feature1Base = createCommit({
      sha: 'feature-1-base',
      message: 'feature 1 base',
      timeMs: 3,
      parentSha: trunkStart.sha,
      childrenSha: ['feature-1-tip', 'feature-2-base']
    })
    const feature1Tip = createCommit({
      sha: 'feature-1-tip',
      message: 'feature 1 tip',
      timeMs: 4,
      parentSha: feature1Base.sha,
      childrenSha: []
    })
    const feature2Base = createCommit({
      sha: 'feature-2-base',
      message: 'feature 2 base',
      timeMs: 5,
      parentSha: feature1Base.sha,
      childrenSha: ['feature-2-tip', 'feature-3-tip']
    })
    const feature2Tip = createCommit({
      sha: 'feature-2-tip',
      message: 'feature 2 tip',
      timeMs: 6,
      parentSha: feature2Base.sha,
      childrenSha: []
    })
    const feature3Tip = createCommit({
      sha: 'feature-3-tip',
      message: 'feature 3 tip',
      timeMs: 7,
      parentSha: feature2Base.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [
        trunkStart,
        trunkTip,
        feature1Base,
        feature1Tip,
        feature2Base,
        feature2Tip,
        feature3Tip
      ],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        }),
        createBranch({
          ref: 'feature/one',
          isTrunk: false,
          isRemote: false,
          headSha: feature1Tip.sha
        }),
        createBranch({
          ref: 'feature/two',
          isTrunk: false,
          isRemote: false,
          headSha: feature2Tip.sha
        }),
        createBranch({
          ref: 'feature/three',
          isTrunk: false,
          isRemote: false,
          headSha: feature3Tip.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    if (!trunkStack) {
      throw new Error('expected trunk stack')
    }
    const level1 = trunkStack.commits[0]
    if (!level1) {
      throw new Error('expected level1 commit')
    }
    const [feature1Stack] = level1.spinoffs
    if (!feature1Stack) {
      throw new Error('expected feature1 stack')
    }
    expect(feature1Stack.commits.map((commit) => commit.sha)).toEqual([
      feature1Base.sha,
      feature1Tip.sha
    ])

    const feature2Continuation = feature1Stack.commits[0]
    if (!feature2Continuation) {
      throw new Error('expected feature2 continuation')
    }
    const [feature2Stack] = feature2Continuation.spinoffs
    if (!feature2Stack) {
      throw new Error('expected feature2 stack')
    }
    expect(feature2Stack.commits.map((commit) => commit.sha)).toEqual([
      feature2Base.sha,
      feature2Tip.sha
    ])
    const feature3Stacks = feature2Stack.commits[0]?.spinoffs ?? []
    expect(feature3Stacks.map((stack) => stack.commits[0]?.sha)).toEqual([feature3Tip.sha])

    const feature1TipCommit = feature1Stack.commits.at(-1)
    const feature2TipCommit = feature2Stack.commits.at(-1)
    const feature3TipStack = feature3Stacks[0]
    if (!feature1TipCommit || !feature2TipCommit || !feature3TipStack) {
      throw new Error('expected branch heads in spinoffs')
    }
    expect(feature1TipCommit.branches).toContainEqual({ name: 'feature/one', isCurrent: false })
    expect(feature2TipCommit.branches).toContainEqual({ name: 'feature/two', isCurrent: false })
    expect(feature3TipStack.commits.at(-1)?.branches).toContainEqual({
      name: 'feature/three',
      isCurrent: false
    })
  })

  it('builds trunk stack even when UiStackBranches selection results in no non-trunk branches', () => {
    const root = createCommit({
      sha: 'root',
      message: 'root',
      timeMs: 1,
      parentSha: '',
      childrenSha: ['main-tip']
    })
    const trunkTip = createCommit({
      sha: 'main-tip',
      message: 'main tip',
      timeMs: 2,
      parentSha: root.sha,
      childrenSha: []
    })

    const repo = createRepo({
      commits: [root, trunkTip],
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: trunkTip.sha
        }),
        createBranch({
          ref: 'origin/feature/foo',
          isTrunk: false,
          isRemote: true,
          headSha: trunkTip.sha
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    expect(trunkStack.isTrunk).toBe(true)
    expect(trunkStack.commits.map((commit) => commit.sha)).toEqual([root.sha, trunkTip.sha])
  })

  it('handles linear trunk-only histories with no spinoffs', () => {
    const commits = [
      createCommit({
        sha: 'c1',
        message: 'first',
        timeMs: 1,
        parentSha: '',
        childrenSha: ['c2']
      }),
      createCommit({
        sha: 'c2',
        message: 'second',
        timeMs: 2,
        parentSha: 'c1',
        childrenSha: ['c3']
      }),
      createCommit({
        sha: 'c3',
        message: 'third',
        timeMs: 3,
        parentSha: 'c2',
        childrenSha: []
      })
    ]

    const repo = createRepo({
      commits,
      branches: [
        createBranch({
          ref: 'main',
          isTrunk: true,
          isRemote: false,
          headSha: 'c3'
        })
      ]
    })

    const trunkStack = expectTrunkStack(repo)
    expect(trunkStack.isTrunk).toBe(true)
    expect(trunkStack.commits.map((commit) => commit.sha)).toEqual(['c1', 'c2', 'c3'])
    trunkStack.commits.forEach((commit) => {
      expect(commit.spinoffs).toEqual([])
    })
  })
})

function expectTrunkStack(repo: Repo) {
  const stack = buildUiStack(repo)
  if (!stack) {
    throw new Error('expected trunk stack')
  }
  return stack
}

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    path: '/tmp/repo',
    commits: [],
    branches: [],
    workingTreeStatus: createWorkingTreeStatus(),
    ...overrides
  }
}

type CommitOverrides = Partial<Omit<Commit, 'sha'>> & Pick<Commit, 'sha'>

function createCommit(overrides: CommitOverrides): Commit {
  const { sha, ...rest } = overrides
  return {
    sha,
    message: '(no message)',
    timeMs: 0,
    parentSha: '',
    childrenSha: [],
    ...rest
  }
}

type BranchOverrides = Partial<Omit<Branch, 'ref' | 'headSha'>> & Pick<Branch, 'ref' | 'headSha'>

function createBranch(overrides: BranchOverrides): Branch {
  const { ref, headSha, ...rest } = overrides
  return {
    ref,
    headSha,
    isTrunk: false,
    isRemote: false,
    ...rest
  }
}

function createWorkingTreeStatus(overrides: Partial<WorkingTreeStatus> = {}): WorkingTreeStatus {
  return {
    currentBranch: 'main',
    currentCommitSha: '',
    tracking: null,
    detached: false,
    isRebasing: false,
    staged: [],
    modified: [],
    created: [],
    deleted: [],
    renamed: [],
    not_added: [],
    conflicted: [],
    allChangedFiles: [],
    ...overrides
  }
}
