import { log } from '@shared/logger'
import type {
  RebaseJob,
  RebasePlan,
  RebaseProjection,
  RebaseState,
  Repo,
  UiStack
} from '@shared/types'
import type { FullUiStateOptions } from './build-ui-state.js'
import { buildFullUiState } from './build-ui-state.js'

export function printUiState(repo: Repo, options: FullUiStateOptions = {}): void {
  const uiState = buildFullUiState(repo, options)

  log.debug('UI State')
  log.debug('========')
  printWorkingTree(uiState.workingTree)
  printStackState('Current', uiState.stack)
  printStackState('Projected', uiState.projectedStack)
  printRebaseProjection(uiState.rebase)
}

function printWorkingTree(status: Repo['workingTreeStatus']): void {
  log.debug('\nWorking Tree:')
  log.debug(`  Branch   : ${status.currentBranch}`)
  log.debug(`  HEAD SHA : ${status.currentCommitSha}`)
  log.debug(
    `  Tracking : ${status.tracking ?? '(no upstream)'}${status.detached ? ' [detached]' : ''}`
  )
  log.debug(`  Rebasing : ${status.isRebasing ? 'yes' : 'no'}`)
}

function printStackState(label: string, stack: UiStack | null): void {
  const hasStack = Boolean(stack)
  log.debug(`\n${label} Stack${hasStack ? '' : 's'} (${hasStack ? 1 : 0} top-level):`)
  if (!stack) {
    log.debug('  (no stacks)')
    return
  }

  const marker = stack.isTrunk ? ' [base]' : ''
  log.debug(`  Stack 1${marker}:`)
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

function printRebaseProjection(projection: RebaseProjection): void {
  log.debug('\nRebase:')
  if (projection.kind === 'idle') {
    log.debug('  state   : idle')
    return
  }

  if (projection.kind === 'planning') {
    log.debug('  state   : planning')
    printPlan(projection.plan)
    return
  }

  log.debug('  state   : rebasing')
  printSession(projection.session)
}

function printPlan(plan: RebasePlan): void {
  log.debug(`  intent  : ${plan.intent.id}`)
  log.debug(`  targets : ${plan.intent.targets.length}`)
  printQueue(plan.state)
}

function printSession(state: RebaseState): void {
  log.debug(`  session : ${state.session.id}`)
  log.debug(`  status  : ${state.session.status}`)
  printQueue(state)
}

function printQueue(state: RebaseState): void {
  const { queue } = state
  log.debug(`  active  : ${queue.activeJobId ?? '(none)'}`)
  log.debug(`  pending : ${queue.pendingJobIds.length}`)
  log.debug(`  blocked : ${queue.blockedJobIds.length}`)
  const orderedJobIds = state.session.jobs
  if (!orderedJobIds.length) {
    log.debug('  jobs    : (none)')
    return
  }

  log.debug('  jobs:')
  orderedJobIds.forEach((jobId, idx) => {
    const job = state.jobsById[jobId]
    if (!job) {
      log.debug(`    ${idx + 1}. ${jobId} (missing)`)
      return
    }
    printJob(job, `    ${idx + 1}.`)
  })
}

function printJob(job: RebaseJob, label: string): void {
  log.debug(`${label} id      : ${job.id}`)
  log.debug(`${label} branch  : ${job.branch}`)
  log.debug(`${label} status  : ${job.status}`)
  log.debug(`${label} base    : ${job.originalBaseSha} -> ${job.targetBaseSha}`)
  log.debug(
    `${label} head    : ${job.originalHeadSha}${job.rebasedHeadSha ? ` => ${job.rebasedHeadSha}` : ''}`
  )
  if (job.conflicts && job.conflicts.length > 0) {
    log.debug(`${label} conflicts: ${job.conflicts.length}`)
  }
}
