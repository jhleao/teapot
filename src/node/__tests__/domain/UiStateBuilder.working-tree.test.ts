import type { Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { UiStateBuilder } from '../../domain'

const buildUiWorkingTree = UiStateBuilder.buildUiWorkingTree

describe('buildUiWorkingTree', () => {
  it('converts WorkingTreeStatus arrays to UiWorkingTreeFile list', () => {
    const repo = createRepo({
      workingTreeStatus: createWorkingTreeStatus({
        staged: ['src/file1.ts'],
        modified: ['src/file2.ts'],
        deleted: ['src/file3.ts'],
        renamed: ['src/file4.ts'],
        not_added: ['src/file5.ts'],
        created: ['src/file6.ts']
      })
    })

    const result = buildUiWorkingTree(repo)

    expect(result).toEqual([
      { path: 'src/file1.ts', stageStatus: 'staged', status: 'modified' },
      { path: 'src/file2.ts', stageStatus: 'unstaged', status: 'modified' },
      { path: 'src/file3.ts', stageStatus: 'unstaged', status: 'deleted' },
      { path: 'src/file4.ts', stageStatus: 'unstaged', status: 'renamed' },
      { path: 'src/file5.ts', stageStatus: 'unstaged', status: 'added' },
      { path: 'src/file6.ts', stageStatus: 'unstaged', status: 'added' }
    ])
  })
})

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    path: '/tmp/repo',
    commits: [],
    branches: [],
    workingTreeStatus: createWorkingTreeStatus(),
    ...overrides
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
