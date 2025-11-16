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

  console.log('UI State')
  console.log('========')
  printWorkingTree(uiState.workingTree)
  printStackState('Current', uiState.stack)
  printStackState('Projected', uiState.projectedStack)
  printRebaseProjection(uiState.rebase)
}

function printWorkingTree(status: Repo['workingTreeStatus']): void {
  console.log('\nWorking Tree:')
  console.log(`  Branch   : ${status.currentBranch}`)
  console.log(`  HEAD SHA : ${status.currentCommitSha}`)
  console.log(
    `  Tracking : ${status.tracking ?? '(no upstream)'}${status.detached ? ' [detached]' : ''}`
  )
  console.log(`  Rebasing : ${status.isRebasing ? 'yes' : 'no'}`)
}

function printStackState(label: string, stack: UiStack | null): void {
  const hasStack = Boolean(stack)
  console.log(`\n${label} Stack${hasStack ? '' : 's'} (${hasStack ? 1 : 0} top-level):`)
  if (!stack) {
    console.log('  (no stacks)')
    return
  }

  const marker = stack.isTrunk ? ' [base]' : ''
  console.log(`  Stack 1${marker}:`)
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

function printRebaseProjection(projection: RebaseProjection): void {
  console.log('\nRebase:')
  if (projection.kind === 'idle') {
    console.log('  state   : idle')
    return
  }

  if (projection.kind === 'planning') {
    console.log('  state   : planning')
    printPlan(projection.plan)
    return
  }

  console.log('  state   : rebasing')
  printSession(projection.session)
}

function printPlan(plan: RebasePlan): void {
  console.log(`  intent  : ${plan.intent.id}`)
  console.log(`  targets : ${plan.intent.targets.length}`)
  printQueue(plan.state)
}

function printSession(state: RebaseState): void {
  console.log(`  session : ${state.session.id}`)
  console.log(`  status  : ${state.session.status}`)
  printQueue(state)
}

function printQueue(state: RebaseState): void {
  const { queue } = state
  console.log(`  active  : ${queue.activeJobId ?? '(none)'}`)
  console.log(`  pending : ${queue.pendingJobIds.length}`)
  console.log(`  blocked : ${queue.blockedJobIds.length}`)
  const orderedJobIds = state.session.jobs
  if (!orderedJobIds.length) {
    console.log('  jobs    : (none)')
    return
  }

  console.log('  jobs:')
  orderedJobIds.forEach((jobId, idx) => {
    const job = state.jobsById[jobId]
    if (!job) {
      console.log(`    ${idx + 1}. ${jobId} (missing)`)
      return
    }
    printJob(job, `    ${idx + 1}.`)
  })
}

function printJob(job: RebaseJob, label: string): void {
  console.log(`${label} id      : ${job.id}`)
  console.log(`${label} branch  : ${job.branch}`)
  console.log(`${label} status  : ${job.status}`)
  console.log(`${label} base    : ${job.originalBaseSha} -> ${job.targetBaseSha}`)
  console.log(
    `${label} head    : ${job.originalHeadSha}${job.rebasedHeadSha ? ` => ${job.rebasedHeadSha}` : ''}`
  )
  if (job.conflicts && job.conflicts.length > 0) {
    console.log(`${label} conflicts: ${job.conflicts.length}`)
  }
}
