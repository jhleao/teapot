import { ipcMain } from 'electron'
import type { Repo } from '@teapot/contract'

function getRepo(): Repo {
  const now = Date.now()
  return {
    path: '/Users/leao/Documents/personal/teapot',
    commits: [
      {
        sha: 'a1b2c3d4e5f6',
        message: 'Initial commit',
        timeMs: now - 172800000, // 2 days ago
        parentSha: '',
        childrenSha: ['b2c3d4e5f6a7']
      },
      {
        sha: 'b2c3d4e5f6a7',
        message: 'Add basic project structure',
        timeMs: now - 151200000, // 1.75 days ago
        parentSha: 'a1b2c3d4e5f6',
        childrenSha: ['c3d4e5f6a7b8', 'd4e5f6a7b8c9']
      },
      {
        sha: 'c3d4e5f6a7b8',
        message: 'Implement core functionality',
        timeMs: now - 129600000, // 1.5 days ago
        parentSha: 'b2c3d4e5f6a7',
        childrenSha: ['e5f6a7b8c9d0']
      },
      {
        sha: 'd4e5f6a7b8c9',
        message: 'Start feature: user authentication',
        timeMs: now - 129600000, // 1.5 days ago
        parentSha: 'b2c3d4e5f6a7',
        childrenSha: ['f6a7b8c9d0e1']
      },
      {
        sha: 'e5f6a7b8c9d0',
        message: 'Add tests for core module',
        timeMs: now - 108000000, // 1.25 days ago
        parentSha: 'c3d4e5f6a7b8',
        childrenSha: ['g7a8b9c0d1e2']
      },
      {
        sha: 'f6a7b8c9d0e1',
        message: 'Implement login flow',
        timeMs: now - 108000000, // 1.25 days ago
        parentSha: 'd4e5f6a7b8c9',
        childrenSha: ['h8b9c0d1e2f3']
      },
      {
        sha: 'g7a8b9c0d1e2',
        message: 'Refactor API layer',
        timeMs: now - 86400000, // 1 day ago
        parentSha: 'e5f6a7b8c9d0',
        childrenSha: ['i9c0d1e2f3a4']
      },
      {
        sha: 'h8b9c0d1e2f3',
        message: 'Add password reset feature',
        timeMs: now - 86400000, // 1 day ago
        parentSha: 'f6a7b8c9d0e1',
        childrenSha: []
      },
      {
        sha: 'i9c0d1e2f3a4',
        message: 'Merge authentication branch',
        timeMs: now - 43200000, // 0.5 days ago
        parentSha: 'g7a8b9c0d1e2',
        childrenSha: ['j0d1e2f3a4b5']
      },
      {
        sha: 'j0d1e2f3a4b5',
        message: 'Fix bug in error handling',
        timeMs: now - 21600000, // 0.25 days ago
        parentSha: 'i9c0d1e2f3a4',
        childrenSha: []
      }
    ],
    branches: [
      {
        ref: 'refs/heads/main',
        isTrunk: true,
        isRemote: false,
        headSha: 'j0d1e2f3a4b5'
      },
      {
        ref: 'refs/heads/feature/auth',
        isTrunk: false,
        isRemote: false,
        headSha: 'h8b9c0d1e2f3'
      },
      {
        ref: 'refs/heads/feature/api-refactor',
        isTrunk: false,
        isRemote: false,
        headSha: 'g7a8b9c0d1e2'
      },
      {
        ref: 'refs/heads/bugfix/error-handling',
        isTrunk: false,
        isRemote: false,
        headSha: 'j0d1e2f3a4b5'
      }
    ],
    workingTreeStatus: {
      currentBranch: 'main',
      currentCommitSha: 'j0d1e2f3a4b5',
      tracking: 'origin/main',
      detached: false,
      isRebasing: false,
      staged: [],
      modified: [],
      created: [],
      deleted: [],
      renamed: [],
      not_added: [],
      conflicted: [],
      allChangedFiles: []
    }
  }
}

export function registerRepoHandlers(): void {
  ipcMain.handle('getRepo', getRepo)
}
