import { describe, it, expect } from 'vitest'
import type {
  Repo,
  Commit,
  Branch,
  WorkingTreeStatus,
  RebaseIntent,
  StackNodeState
} from '@shared/types'
import { buildUiStack, buildFullUiState } from '../build-ui-state.js'

const COMMITS = {
  cde: 'cde3150c3d2772348b51cd0ce26a87a8b250996c',
  nineF: '9f6228f9e3af511cfc148d9550fae37b652b4fad',
  f06: 'f06fe726a466125f378b41eb123263a5334f69eb',
  a081: 'a0810e70c394de6ebcad417940c7a60303e3e8ff',
  trunk: '54168a206064ed48950c13e1f166a0fbda846e9b',
  stack827: '827eb5e7f8f42674d0fd87c95afeceadbee76292',
  stack3e: '3e0141b7a21cc87fd0c267961c8686228e923306',
  stack234: '234e95fe1f131dbef5385c005cdc7d4ff6193fe6',
  stackBf5: 'bf519728d55144d5faa6320bb7eb102d3c27ab95',
  stack799: '799e650369e94ed8cdf5cc4ba28ae590e52401e5',
  stack647: '647298e43f5d059a41fa40bba2bdc3a9ebc0286f',
  stack985: '985e6c7035089a6a2300bccdc5d2f15ad1fe85d3',
  stack4b0: '4b0a3c5a9eb1fa6a0e037d151bbbeece1b22e69a',
  stack582: '582ec99bffeaccb54a13321adbf081e30b09c34f',
  stackE94: 'e94527fb222c7b8b956489609d3f60794664a77d',
  stack8a2: '8a28b90b56c54e3d8444287ab236697d5e224be0',
  stack915: '915d64bfe54d1a2e322a95876a96f711f6804ff0',
  stackB86: 'b86329aa373d987964bf699d5ed24f106abd89dd',
  stack843: '843b5d5fe4b489e64f272f53325705e1d82b9916',
  stack50b: '50b27d7cef5dfc002aeb126ade220a030219d6a0',
  stack62f: '62f0fb5c112290f1d36dbb74511eea136558a25f',
  stackC83: 'c8376c1e8ef756889f4f63569d08b0ba1093d30a',
  stack28b: '28b7ecd700e8c916320267c4fcce618e7b3f808d'
}

describe('buildUiState (stack projection scenarios)', () => {
  it('builds the baseline stack layout for the sample repo', () => {
    const repo = createSampleRepo()
    const stack = buildUiStack(repo)
    expect(stack).not.toBeNull()
    if (!stack) {
      throw new Error('expected trunk stack')
    }

    expect(stack.commits.map((commit) => commit.sha)).toEqual([
      COMMITS.cde,
      COMMITS.nineF,
      COMMITS.f06,
      COMMITS.a081,
      COMMITS.trunk
    ])

    const trunkTip = stack.commits.at(-1)
    if (!trunkTip) {
      throw new Error('expected trunk tip')
    }
    expect(trunkTip.branches.map((branch) => branch.name)).toContain('main')

    expect(trunkTip.spinoffs).toHaveLength(3)

    const stackFromTrunk = (idx: number) => trunkTip.spinoffs[idx]?.commits ?? []
    expect(stackFromTrunk(0).map((commit) => commit.sha)).toEqual([
      COMMITS.stack827,
      COMMITS.stack3e,
      COMMITS.stack234,
      COMMITS.stackBf5,
      COMMITS.stack799,
      COMMITS.stack647
    ])
    expect(stackFromTrunk(2).map((commit) => commit.sha)).toEqual([COMMITS.stack985])

    const branchCommit = stackFromTrunk(0).find((commit) => commit.sha === COMMITS.stack234)
    if (!branchCommit) {
      throw new Error('expected branch commit 234')
    }
    expect(branchCommit.branches.map((branch) => branch.name)).toContain('spr-d0e7cf')
  })

  it('projects the stack after submitting the demo rebase intent', () => {
    const repo = createSampleRepo()
    const intent = createDemoRebaseIntent()
    const uiState = buildFullUiState(repo, { rebaseIntent: intent })

    expect(uiState.projectedStack).not.toBeNull()
    const projectedStack = uiState.projectedStack
    if (!projectedStack) {
      throw new Error('expected projected stack')
    }

    const trunkTip = projectedStack.commits.at(-1)
    if (!trunkTip) {
      throw new Error('expected trunk tip')
    }

    const firstSpinoff = trunkTip.spinoffs[0]
    expect(firstSpinoff?.commits.map((commit) => commit.sha)).toEqual([
      COMMITS.stack827,
      COMMITS.stack3e
    ])

    const reparentedStack = trunkTip.spinoffs.find(
      (stack) => stack.commits[0]?.sha === COMMITS.stack985
    )
    if (!reparentedStack) {
      throw new Error('expected stack rooted at 985')
    }
    expect(reparentedStack.commits.map((commit) => commit.sha)).toEqual([
      COMMITS.stack985,
      COMMITS.stack234,
      COMMITS.stackBf5,
      COMMITS.stack799,
      COMMITS.stack647
    ])

    const timestampBase = reparentedStack.commits[0]
    const timestampHead = reparentedStack.commits[1]
    if (!timestampBase || !timestampHead) {
      throw new Error('expected projected head')
    }
    expect(timestampHead.timestampMs).toBeGreaterThan(timestampBase.timestampMs)
  })
})

function createSampleRepo(): Repo {
  const commits: Commit[] = [
    createCommit(
      COMMITS.cde,
      '',
      [COMMITS.nineF],
      'feat: ui models and mocking (#13)',
      '2025-11-16T08:46:05.000Z'
    ),
    createCommit(
      COMMITS.nineF,
      COMMITS.cde,
      [COMMITS.f06, COMMITS.stack62f, COMMITS.stackC83, COMMITS.stack28b],
      'feat: basic ui components (#14)',
      '2025-11-16T08:46:21.000Z'
    ),
    createCommit(
      COMMITS.f06,
      COMMITS.nineF,
      [COMMITS.a081],
      'uodated backed to new ui model',
      '2025-11-16T09:27:46.000Z'
    ),
    createCommit(
      COMMITS.a081,
      COMMITS.f06,
      [COMMITS.trunk],
      'added unit tests (#15)',
      '2025-11-16T10:35:08.000Z'
    ),
    createCommit(
      COMMITS.trunk,
      COMMITS.a081,
      [COMMITS.stack827, COMMITS.stack4b0, COMMITS.stack985],
      'changed buildUiState signature to UiStack | null (#16)',
      '2025-11-16T11:04:00.000Z'
    ),
    createCommit(
      COMMITS.stack827,
      COMMITS.trunk,
      [COMMITS.stack3e],
      'add initial rebase queue concept',
      '2025-11-16T12:33:53.000Z'
    ),
    createCommit(
      COMMITS.stack3e,
      COMMITS.stack827,
      [COMMITS.stack234],
      'ui model now calculated from queue and git',
      '2025-11-16T13:18:21.000Z'
    ),
    createCommit(
      COMMITS.stack234,
      COMMITS.stack3e,
      [COMMITS.stackBf5],
      'fixed ui model to be calculated from queue',
      '2025-11-16T15:27:38.000Z'
    ),
    createCommit(
      COMMITS.stackBf5,
      COMMITS.stack234,
      [COMMITS.stack799],
      'exposing a public api',
      '2025-11-16T15:43:10.000Z'
    ),
    createCommit(
      COMMITS.stack799,
      COMMITS.stackBf5,
      [COMMITS.stack647],
      'changing timestamp for rebase intent affected commits',
      '2025-11-16T16:06:38.000Z'
    ),
    createCommit(
      COMMITS.stack647,
      COMMITS.stack799,
      [],
      'upd to test data',
      '2025-11-16T16:11:13.000Z'
    ),
    createCommit(COMMITS.stack985, COMMITS.trunk, [], 'dummy comment', '2025-11-16T13:20:38.000Z'),
    createCommit(
      COMMITS.stack4b0,
      COMMITS.trunk,
      [COMMITS.stack582],
      'fix: render sibling spinoffs (#17)',
      '2025-11-16T12:37:47.000Z'
    ),
    createCommit(
      COMMITS.stack582,
      COMMITS.stack4b0,
      [COMMITS.stackE94],
      'feat: use semantic colors (#18)',
      '2025-11-16T12:38:00.000Z'
    ),
    createCommit(
      COMMITS.stackE94,
      COMMITS.stack582,
      [COMMITS.stack8a2],
      'feat: drag and drop (#19)',
      '2025-11-16T12:38:15.000Z'
    ),
    createCommit(
      COMMITS.stack8a2,
      COMMITS.stackE94,
      [COMMITS.stack915, COMMITS.stack843, COMMITS.stack50b],
      'chore: re-scaffold repository on top level electron (#20)',
      '2025-11-16T12:59:18.000Z'
    ),
    createCommit(
      COMMITS.stack915,
      COMMITS.stack8a2,
      [COMMITS.stackB86],
      'chore: run formatter (#21)',
      '2025-11-16T13:06:21.000Z'
    ),
    createCommit(
      COMMITS.stackB86,
      COMMITS.stack915,
      [],
      'chore: update entrypoint dir names (#22)',
      '2025-11-16T13:11:42.000Z'
    ),
    createCommit(
      COMMITS.stack843,
      COMMITS.stack8a2,
      [],
      'chore: update entrypoint dir names',
      '2025-11-16T13:11:22.000Z'
    ),
    createCommit(
      COMMITS.stack50b,
      COMMITS.stack8a2,
      [],
      'chore: run formatter',
      '2025-11-16T13:02:07.000Z'
    ),
    createCommit(
      COMMITS.stack62f,
      COMMITS.nineF,
      [],
      'fix: render sibling spinoffs',
      '2025-11-16T09:51:52.000Z'
    ),
    createCommit(
      COMMITS.stackC83,
      COMMITS.nineF,
      [],
      'feat: use semantic colors',
      '2025-11-16T10:03:30.000Z'
    ),
    createCommit(
      COMMITS.stack28b,
      COMMITS.nineF,
      [],
      'feat: drag and drop',
      '2025-11-16T10:14:18.000Z'
    )
  ]

  const branches: Branch[] = [
    createBranch('main', COMMITS.trunk, { isTrunk: true }),
    createBranch('spr-d72d0f', COMMITS.stack827),
    createBranch('spr-d0e7cf', COMMITS.stack234),
    createBranch('spr-17ee75', COMMITS.stack234),
    createBranch('spr-ec3b3f', COMMITS.stackBf5),
    createBranch('spr-042988', COMMITS.stack799),
    createBranch('spr-dd0a8a', COMMITS.stack647),
    createBranch('spr-853278', COMMITS.stack985),
    createBranch('spr-4ec0bc', COMMITS.stack4b0)
  ]

  return {
    path: '/tmp/sample',
    commits,
    branches,
    workingTreeStatus: createWorkingTreeStatus({
      currentBranch: 'spr-dd0a8a',
      currentCommitSha: COMMITS.stack647
    })
  }
}

function createCommit(
  sha: string,
  parentSha: string,
  childrenSha: string[],
  message: string,
  isoTime: string
): Commit {
  return {
    sha,
    parentSha,
    childrenSha,
    message,
    timeMs: Date.parse(isoTime)
  }
}

function createBranch(
  ref: string,
  headSha: string,
  options: { isTrunk?: boolean; isRemote?: boolean } = {}
): Branch {
  const { isTrunk = false, isRemote = false } = options
  return {
    ref,
    headSha,
    isTrunk,
    isRemote
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

function createDemoRebaseIntent(): RebaseIntent {
  return {
    id: 'demo-rebase',
    createdAtMs: Date.parse('2025-11-16T16:12:05.369Z'),
    targets: [
      {
        node: createStackNodeState(COMMITS.stack234, COMMITS.stack3e, 'spr-d0e7cf', [
          createStackNodeState(COMMITS.stackBf5, COMMITS.stack234, 'spr-ec3b3f', [
            createStackNodeState(COMMITS.stack799, COMMITS.stackBf5, 'spr-042988', [
              createStackNodeState(COMMITS.stack647, COMMITS.stack799, 'spr-dd0a8a', [])
            ])
          ])
        ]),
        targetBaseSha: COMMITS.stack985
      }
    ]
  }
}

function createStackNodeState(
  headSha: string,
  baseSha: string,
  branch: string,
  children: StackNodeState[]
): StackNodeState {
  return {
    branch,
    headSha,
    baseSha,
    children
  }
}
