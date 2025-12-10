import { log } from '@shared/logger'
import { Configuration, RebaseIntent, RebaseTarget } from '@shared/types'
import { getGitAdapter } from '../git-adapter'
import { createRebasePlan } from '../rebase'
import { executeRebasePlan } from '../rebase-executor'
import { createStoredSession, rebaseSessionStore } from '../rebase-session-store'
import { buildRebaseIntent } from './build-rebase-intent'
import { buildRepoModel } from './build-repo'
import { getAuthorIdentity } from './get-author-identity'
import { createJobIdGenerator } from './job-id-generator'
import { findDirectChildBranches } from './stack-traversal'

export async function amend(repoPath: string, message?: string): Promise<void> {
  const config: Configuration = { repoPath }
  const git = getGitAdapter()

  // 1. Identify children before amending
  let childrenToRebase: string[] = []

  try {
    const repo = await buildRepoModel(config)
    const currentBranchName = await git.currentBranch(repoPath)

    if (currentBranchName) {
      const currentBranch = repo.branches.find((b) => b.ref === currentBranchName)
      if (currentBranch && currentBranch.headSha) {
        const commitMap = new Map(repo.commits.map((c) => [c.sha, c]))
        const childBranches = findDirectChildBranches(
          repo.branches,
          commitMap,
          currentBranch.headSha
        )
        childrenToRebase = childBranches.map((b) => b.ref)
      }
    }
  } catch (err) {
    log.warn('Failed to identify children for auto-rebase:', err)
  }

  // 2. Perform Amend (Core Logic)
  const headCommitOid = await git.resolveRef(repoPath, 'HEAD')
  const headCommit = await git.readCommit(repoPath, headCommitOid)
  const currentIdentity = await getAuthorIdentity(repoPath)

  await git.commit(repoPath, {
    message: message || headCommit.message,
    author: {
      name: headCommit.author.name,
      email: headCommit.author.email
    },
    committer: {
      name: currentIdentity.name,
      email: currentIdentity.email
    },
    amend: true
  })

  // 3. Auto-rebase children if needed
  if (childrenToRebase.length > 0) {
    await rebaseChildrenAfterAmend(repoPath, childrenToRebase, config, git)
  }
}

/**
 * Rebases child branches after an amend operation.
 *
 * This function identifies child branches that need to be rebased onto the
 * newly amended commit and executes the rebase operation.
 */
async function rebaseChildrenAfterAmend(
  repoPath: string,
  childrenToRebase: string[],
  config: Configuration,
  git: ReturnType<typeof getGitAdapter>
): Promise<void> {
  try {
    const newRepo = await buildRepoModel(config)
    const newHeadSha = await git.resolveRef(repoPath, 'HEAD')
    const targets: RebaseTarget[] = []

    for (const childName of childrenToRebase) {
      const childBranch = newRepo.branches.find((b) => b.ref === childName)
      if (!childBranch?.headSha) continue

      const intent = buildRebaseIntent(newRepo, childBranch.headSha, newHeadSha)
      if (intent) {
        targets.push(...intent.targets)
      }
    }

    if (targets.length > 0) {
      const compositeIntent: RebaseIntent = {
        id: `auto-rebase-${Date.now()}`,
        createdAtMs: Date.now(),
        targets
      }

      const plan = createRebasePlan({
        repo: newRepo,
        intent: compositeIntent,
        generateJobId: createJobIdGenerator()
      })

      const currentBranchName = await git.currentBranch(repoPath)
      const storedSession = createStoredSession(plan, currentBranchName || 'HEAD')
      await rebaseSessionStore.createSession(repoPath, storedSession)

      const result = await executeRebasePlan(
        repoPath,
        { intent: compositeIntent, state: plan.state },
        git
      )

      if (result.status === 'completed') {
        await rebaseSessionStore.clearSession(repoPath)
      } else if (result.status === 'error') {
        console.error('Auto-rebase failed:', result.message)
        await rebaseSessionStore.clearSession(repoPath)
      }
    }
  } catch (err) {
    console.error('Failed to auto-rebase children after amend:', err)
  }
}
