/**
 * Rebase Intent Builder
 *
 * Builds a RebaseIntent from a head SHA and target base SHA.
 * The intent represents the user's desire to rebase a branch (and its descendants)
 * onto a new base commit.
 */

import { Branch, Commit, RebaseIntent, Repo, StackNodeState } from '@shared/types'
import { buildBranchHeadIndex } from './stack-traversal'

/**
 * Builds a RebaseIntent for rebasing a branch onto a new base.
 *
 * @param repo - The repository state
 * @param headSha - The head SHA of the branch to rebase
 * @param baseSha - The target base SHA to rebase onto
 * @returns RebaseIntent or null if the operation is invalid
 */
export function buildRebaseIntent(
  repo: Repo,
  headSha: string,
  baseSha: string
): RebaseIntent | null {
  const commitMap = new Map<string, Commit>(repo.commits.map((commit) => [commit.sha, commit]))
  if (!commitMap.has(headSha) || !commitMap.has(baseSha)) {
    return null
  }

  const branchHeadIndex = buildBranchHeadIndex(repo.branches)
  const node = buildStackNodeState(repo, commitMap, branchHeadIndex, headSha, new Set())
  if (!node) {
    return null
  }

  return {
    id: `preview-${headSha}-${Date.now()}`,
    createdAtMs: Date.now(),
    targets: [
      {
        node,
        targetBaseSha: baseSha
      }
    ]
  }
}

/**
 * Builds a StackNodeState tree rooted at the given head SHA.
 * Recursively includes all child branches that depend on this branch.
 *
 * IMPORTANT: The baseSha is computed by walking backwards through commits
 * until we find a commit that has another branch pointing to it (fork point).
 * This correctly handles multi-commit branches.
 */
function buildStackNodeState(
  repo: Repo,
  commitMap: Map<string, Commit>,
  branchHeadIndex: Map<string, string[]>,
  headSha: string,
  visited: Set<string>
): StackNodeState | null {
  if (visited.has(headSha)) {
    return null
  }

  const commit = commitMap.get(headSha)
  if (!commit) {
    return null
  }

  const branchName = selectBranchName(repo.branches, headSha)
  if (!branchName) {
    return null
  }

  visited.add(headSha)

  // Find the base SHA by walking backwards through commits
  const baseSha = findBaseSha(headSha, branchName, commitMap, branchHeadIndex, repo.branches)

  // Find child branches - branches whose baseSha equals our headSha
  // This handles both single-commit and multi-commit child branches
  const childBranches = findChildBranchesWithForkPoint(
    repo,
    commitMap,
    branchHeadIndex,
    headSha,
    branchName
  )
  const children: StackNodeState[] = []

  for (const childBranch of childBranches) {
    const childNode = buildStackNodeState(
      repo,
      commitMap,
      branchHeadIndex,
      childBranch.headSha,
      visited
    )
    if (childNode) {
      children.push(childNode)
    }
  }

  visited.delete(headSha)

  return {
    branch: branchName,
    headSha,
    baseSha,
    children
  }
}

/**
 * Finds child branches whose fork point (baseSha) is at the given headSha.
 * This handles multi-commit child branches correctly.
 */
function findChildBranchesWithForkPoint(
  repo: Repo,
  commitMap: Map<string, Commit>,
  branchHeadIndex: Map<string, string[]>,
  parentHeadSha: string,
  parentBranchName: string
): Branch[] {
  const childBranches: Branch[] = []

  for (const branch of repo.branches) {
    // Skip remote branches
    if (branch.isRemote) continue
    // Skip trunk branches
    if (branch.isTrunk) continue
    // Skip the parent branch itself
    if (branch.ref === parentBranchName) continue
    // Skip if no headSha
    if (!branch.headSha) continue
    // Skip if same headSha as parent (would be same branch effectively)
    if (branch.headSha === parentHeadSha) continue

    // Calculate this branch's baseSha to see if it forks from parentHeadSha
    const branchBaseSha = findBaseSha(
      branch.headSha,
      branch.ref,
      commitMap,
      branchHeadIndex,
      repo.branches
    )

    if (branchBaseSha === parentHeadSha) {
      childBranches.push(branch)
    }
  }

  return childBranches
}

/**
 * Finds the base SHA (fork point) for a branch.
 *
 * Algorithm:
 * 1. Start at branch head
 * 2. Walk backwards through parent commits
 * 3. Stop when we find a commit that:
 *    a. Has another branch pointing to it (other than current branch), OR
 *    b. Is on trunk, OR
 *    c. Is the root commit (no parent)
 * 4. That commit is the baseSha (the fork point)
 *
 * Example:
 * ```
 * trunk: A -- B -- C (main)
 *                  \
 * feature:          D -- E -- F (feature-branch)
 *                              \
 * child:                        G -- H (child-branch)
 * ```
 *
 * - feature-branch: head=F, baseSha=C (walked F->E->D, stopped at C because main points there)
 * - child-branch: head=H, baseSha=F (walked H->G, stopped at F because feature-branch points there)
 */
function findBaseSha(
  headSha: string,
  branchRef: string,
  commitMap: Map<string, Commit>,
  branchHeadIndex: Map<string, string[]>,
  allBranches: Branch[]
): string {
  // Build set of trunk SHAs for quick lookup
  const trunkBranch = allBranches.find((b) => b.isTrunk && !b.isRemote)
  const trunkShas = new Set<string>()

  if (trunkBranch) {
    // Walk trunk to build set of trunk commits
    let currentSha: string | undefined = trunkBranch.headSha
    const visited = new Set<string>()
    while (currentSha && !visited.has(currentSha)) {
      visited.add(currentSha)
      trunkShas.add(currentSha)
      const commit = commitMap.get(currentSha)
      currentSha = commit?.parentSha || undefined
    }
  }

  // Walk backwards from head to find fork point
  let currentSha: string | undefined = headSha
  const visited = new Set<string>()

  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha)
    const commit = commitMap.get(currentSha)
    if (!commit) break

    const parentSha = commit.parentSha
    if (!parentSha) {
      // Reached root commit - this commit IS the base
      return currentSha
    }

    // Check if parent is on trunk
    if (trunkShas.has(parentSha)) {
      return parentSha
    }

    // Check if parent has other branches pointing to it
    const branchesAtParent = branchHeadIndex.get(parentSha) ?? []
    const otherBranches = branchesAtParent.filter((b) => b !== branchRef)

    if (otherBranches.length > 0) {
      // Parent is a branch point - that's our base
      return parentSha
    }

    currentSha = parentSha
  }

  // Fallback: if we walked all the way without finding a fork point,
  // the base is the last valid parent we found
  const headCommit = commitMap.get(headSha)
  return headCommit?.parentSha || headSha
}

/**
 * Selects the best branch name for a given head SHA.
 * Prefers local non-trunk branches, then local trunk, then any branch.
 */
function selectBranchName(branches: Branch[], headSha: string): string | null {
  // Prefer local non-trunk branch
  const localBranch = branches.find(
    (branch) => branch.headSha === headSha && !branch.isRemote && !branch.isTrunk
  )
  if (localBranch) {
    return localBranch.ref
  }

  // Fallback to any local branch
  const fallbackLocal = branches.find((branch) => branch.headSha === headSha && !branch.isRemote)
  if (fallbackLocal) {
    return fallbackLocal.ref
  }

  // Last resort: any branch
  const anyBranch = branches.find((branch) => branch.headSha === headSha)
  return anyBranch?.ref ?? null
}
