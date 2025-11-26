import type { Repo, UiStack } from '@shared/types'
import { buildUiStack } from './build-ui-state.js'
import { log } from '@shared/logger'

export function printRepo(repo: Repo): void {
  printWorkingTree(repo)
  log.debug(`\nBranches (${repo.branches.length}):`)

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
    log.debug(`  - ${branch.ref}${trunkMarker}${remoteMarker} -> ${headSha}`)
  })

  log.debug(`\nCommits (${repo.commits.length}):`)
  repo.commits.forEach((commit) => {
    const timestamp = commit.timeMs > 0 ? new Date(commit.timeMs).toISOString() : 'unknown date'
    const parent = commit.parentSha || 'none'
    const children = commit.childrenSha.length > 0 ? commit.childrenSha.join(', ') : 'none'
    const message = commit.message.split('\n')[0] || '(no message)'
    log.debug(`  - ${commit.sha}`)
    log.debug(`      message : ${message}`)
    log.debug(`      time    : ${timestamp}`)
    log.debug(`      parent  : ${parent}`)
    log.debug(`      children: ${children}`)
  })

  printStackState(repo)
}

function printWorkingTree(repo: Repo): void {
  const status = repo.workingTreeStatus
  log.debug('\nWorking Tree:')
  log.debug(`  Branch   : ${status.currentBranch}`)
  log.debug(`  HEAD SHA : ${status.currentCommitSha}`)
  log.debug(
    `  Tracking : ${status.tracking ?? '(no upstream)'}${status.detached ? ' [detached]' : ''}`
  )
  log.debug(`  Rebasing : ${status.isRebasing ? 'yes' : 'no'}`)
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
    log.debug(`  ${label.padEnd(10)}: ${files.length > 0 ? files.join(', ') : '(none)'}`)
  })
  log.debug(
    `  All changed: ${status.allChangedFiles.length > 0 ? status.allChangedFiles.join(', ') : '(none)'}`
  )
}

function printStackState(repo: Repo): void {
  const stack = buildUiStack(repo)
  const hasStack = stack !== null
  log.debug(`\nStacks (${hasStack ? 1 : 0} top-level):`)
  if (!stack) {
    log.debug('  (no stacks)')
    return
  }
  const stackLabel = stack.isTrunk ? ' [base]' : ''
  log.debug(`  Stack 1${stackLabel}:`)
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
    log.debug(`${indent}- ${commit.sha} ${commit.name}`)
    log.debug(`${indent}    time     : ${timestamp}`)
    log.debug(`${indent}    branches : ${branchSummary}`)
    if (commit.spinoffs.length > 0) {
      log.debug(`${indent}    spinoffs:`)
      commit.spinoffs.forEach((spinoff, idx) => {
        log.debug(`${indent}      -> ${idx + 1}`)
        printStack(spinoff, `${indent}         `)
      })
    }
  })
}
