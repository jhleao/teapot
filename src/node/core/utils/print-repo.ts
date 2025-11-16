import type { Repo, UiStack } from '@shared/types'
import { buildUiState } from './build-ui-state.js'

export function printRepo(repo: Repo): void {
  printWorkingTree(repo)
  console.log(`\nBranches (${repo.branches.length}):`)

  const sortedBranches = [...repo.branches].sort((a, b) => {
    if (a.isTrunk && !b.isTrunk) return -1
    if (!a.isTrunk && b.isTrunk) return 1
    if (a.isRemote && !b.isRemote) return 1
    if (!a.isRemote && b.isRemote) return -1
    return a.ref.localeCompare(b.ref)
  })

  sortedBranches.forEach((branch) => {
    const trunkMarker = branch.isTrunk ? ' (TRUNK)' : ''
    const remoteMarker = branch.isRemote ? ' [remote]' : ' [local]'
    const headSha = branch.headSha || 'unknown'
    console.log(`  - ${branch.ref}${trunkMarker}${remoteMarker} -> ${headSha}`)
  })

  console.log(`\nCommits (${repo.commits.length}):`)
  repo.commits.forEach((commit) => {
    const timestamp = commit.timeMs > 0 ? new Date(commit.timeMs).toISOString() : 'unknown date'
    const parent = commit.parentSha || 'none'
    const children = commit.childrenSha.length > 0 ? commit.childrenSha.join(', ') : 'none'
    const message = commit.message.split('\n')[0] || '(no message)'
    console.log(`  - ${commit.sha}`)
    console.log(`      message : ${message}`)
    console.log(`      time    : ${timestamp}`)
    console.log(`      parent  : ${parent}`)
    console.log(`      children: ${children}`)
  })

  printStackState(repo)
}

function printWorkingTree(repo: Repo): void {
  const status = repo.workingTreeStatus
  console.log('\nWorking Tree:')
  console.log(`  Branch   : ${status.currentBranch}`)
  console.log(`  HEAD SHA : ${status.currentCommitSha}`)
  console.log(
    `  Tracking : ${status.tracking ?? '(no upstream)'}${status.detached ? ' [detached]' : ''}`
  )
  console.log(`  Rebasing : ${status.isRebasing ? 'yes' : 'no'}`)
  const sections: Array<[string, string[]]> = [
    ['Staged', status.staged],
    ['Modified', status.modified],
    ['Created', status.created],
    ['Deleted', status.deleted],
    ['Renamed', status.renamed],
    ['Untracked', status.not_added],
    ['Conflicted', status.conflicted]
  ]
  sections.forEach(([label, files]) => {
    console.log(`  ${label.padEnd(10)}: ${files.length > 0 ? files.join(', ') : '(none)'}`)
  })
  console.log(
    `  All changed: ${status.allChangedFiles.length > 0 ? status.allChangedFiles.join(', ') : '(none)'}`
  )
}

function printStackState(repo: Repo): void {
  const stack = buildUiState(repo)
  const hasStack = stack !== null
  console.log(`\nStacks (${hasStack ? 1 : 0} top-level):`)
  if (!stack) {
    console.log('  (no stacks)')
    return
  }
  const stackLabel = stack.isTrunk ? ' [base]' : ''
  console.log(`  Stack 1${stackLabel}:`)
  printStack(stack, '    ')
}

function printStack(stack: UiStack, indent: string): void {
  stack.commits.forEach((commit) => {
    const timestamp =
      commit.timestampMs > 0 ? new Date(commit.timestampMs).toISOString() : 'unknown'
    const branchSummary =
      commit.branches.length > 0
        ? commit.branches
            .map((branch) => `${branch.name}${branch.isCurrent ? ' [current]' : ''}`)
            .join(', ')
        : '(none)'
    console.log(`${indent}- ${commit.sha} ${commit.name}`)
    console.log(`${indent}    time     : ${timestamp}`)
    console.log(`${indent}    branches : ${branchSummary}`)
    if (commit.spinoffs.length > 0) {
      console.log(`${indent}    spinoffs:`)
      commit.spinoffs.forEach((spinoff, idx) => {
        console.log(`${indent}      -> ${idx + 1}`)
        printStack(spinoff, `${indent}         `)
      })
    }
  })
}
