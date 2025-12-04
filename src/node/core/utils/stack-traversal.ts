/**
 * Stack Traversal Utilities
 *
 * Pure functions for traversing and querying StackNodeState trees.
 * These utilities are used by both the rebase intent builder and executor.
 */

import type { Branch, Commit, RebaseIntent, StackNodeState } from '@shared/types'

/**
 * Walks through all nodes in a stack tree, calling the visitor for each node.
 * Traversal is depth-first, parent before children.
 */
export function walkStackNodes(
  root: StackNodeState,
  visitor: (node: StackNodeState, depth: number) => void
): void {
  function walk(node: StackNodeState, depth: number): void {
    visitor(node, depth)
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
}

/**
 * Finds a node by branch name within a RebaseIntent's target trees.
 * Returns null if not found.
 */
export function findNodeByBranch(
  intent: RebaseIntent,
  branchName: string
): StackNodeState | null {
  for (const target of intent.targets) {
    const found = findNodeInTree(target.node, branchName)
    if (found) {
      return found
    }
  }
  return null
}

/**
 * Finds a node by branch name within a single StackNodeState tree.
 */
export function findNodeInTree(
  root: StackNodeState,
  branchName: string
): StackNodeState | null {
  if (root.branch === branchName) {
    return root
  }
  for (const child of root.children) {
    const found = findNodeInTree(child, branchName)
    if (found) {
      return found
    }
  }
  return null
}

/**
 * Flattens a StackNodeState tree into an array, depth-first order.
 */
export function flattenStack(root: StackNodeState): StackNodeState[] {
  const result: StackNodeState[] = []
  walkStackNodes(root, (node) => {
    result.push(node)
  })
  return result
}

/**
 * Computes the maximum depth of a stack tree.
 * A single node has depth 1.
 */
export function computeStackDepth(root: StackNodeState): number {
  let maxDepth = 0
  walkStackNodes(root, (_node, depth) => {
    maxDepth = Math.max(maxDepth, depth + 1)
  })
  return maxDepth
}

/**
 * Counts total nodes in a stack tree.
 */
export function countStackNodes(root: StackNodeState): number {
  let count = 0
  walkStackNodes(root, () => {
    count++
  })
  return count
}

/**
 * Gets all branch names in a stack tree.
 */
export function getStackBranches(root: StackNodeState): string[] {
  const branches: string[] = []
  walkStackNodes(root, (node) => {
    branches.push(node.branch)
  })
  return branches
}

/**
 * Builds an index mapping commit SHAs to branch names that point to them.
 * Used for finding fork points when walking backwards through commits.
 */
export function buildBranchHeadIndex(branches: Branch[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const branch of branches) {
    if (!branch.headSha) continue
    const existing = index.get(branch.headSha) ?? []
    existing.push(branch.ref)
    index.set(branch.headSha, existing)
  }
  return index
}

/**
 * Finds child branches that stem directly from a given parent commit.
 * A child branch is one whose head's parent is the parentHeadSha.
 *
 * @param branches - All branches in the repository
 * @param commitMap - Map of SHA to Commit
 * @param parentHeadSha - The SHA to find children of
 * @param options - Filter options
 */
export function findDirectChildBranches(
  branches: Branch[],
  commitMap: Map<string, Commit>,
  parentHeadSha: string,
  options: { excludeRemote?: boolean; excludeTrunk?: boolean } = {}
): Branch[] {
  const { excludeRemote = true, excludeTrunk = true } = options

  return branches.filter((branch) => {
    // Apply filters
    if (excludeRemote && branch.isRemote) return false
    if (excludeTrunk && branch.isTrunk) return false

    // Don't include the parent itself
    if (branch.headSha === parentHeadSha) return false

    // Check if this branch's head has parentHeadSha as its parent
    const commit = commitMap.get(branch.headSha)
    return commit?.parentSha === parentHeadSha
  })
}

/**
 * Walks backwards through commit history from a given SHA until a stopping condition is met.
 * Returns the SHAs visited in order (from head backwards).
 */
export function walkCommitHistory(
  startSha: string,
  commitMap: Map<string, Commit>,
  shouldStop: (commit: Commit, sha: string) => boolean,
  options: { maxDepth?: number } = {}
): string[] {
  const { maxDepth = 1000 } = options
  const visited: string[] = []
  const seen = new Set<string>()

  let currentSha: string | undefined = startSha

  while (currentSha && !seen.has(currentSha) && visited.length < maxDepth) {
    seen.add(currentSha)
    const commit = commitMap.get(currentSha)
    if (!commit) break

    visited.push(currentSha)

    if (shouldStop(commit, currentSha)) {
      break
    }

    currentSha = commit.parentSha || undefined
  }

  return visited
}

/**
 * Counts commits between two SHAs (exclusive of base, inclusive of head).
 * Returns 0 if head is not reachable from base or if they're the same.
 */
export function countCommitsInRange(
  baseSha: string,
  headSha: string,
  commitMap: Map<string, Commit>
): number {
  if (baseSha === headSha) return 0

  const visited = walkCommitHistory(headSha, commitMap, (commit, sha) => {
    return sha === baseSha || commit.parentSha === baseSha
  })

  // If we found the base, the count is the number of commits visited
  // (excluding the base itself which isn't in the range)
  const lastVisited = visited[visited.length - 1]
  if (lastVisited) {
    const lastCommit = commitMap.get(lastVisited)
    if (lastCommit?.parentSha === baseSha || lastVisited === baseSha) {
      // Don't count baseSha itself if it was visited
      return lastVisited === baseSha ? visited.length - 1 : visited.length
    }
  }

  return visited.length
}

/**
 * Gets commits in a range (exclusive of base, inclusive of head).
 * Returns commits in topological order (oldest to newest).
 */
export function getCommitsInRange(
  baseSha: string,
  headSha: string,
  commitMap: Map<string, Commit>
): Commit[] {
  if (baseSha === headSha) return []

  const shas = walkCommitHistory(headSha, commitMap, (_commit, sha) => {
    return sha === baseSha
  })

  // Remove baseSha if it was included
  const filtered = shas.filter((sha) => sha !== baseSha)

  // Reverse to get oldest-to-newest order
  return filtered
    .reverse()
    .map((sha) => commitMap.get(sha))
    .filter((c): c is Commit => c !== undefined)
}
