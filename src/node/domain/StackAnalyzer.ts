/**
 * StackAnalyzer - Pure domain logic for stack tree traversal and analysis.
 *
 * This class consolidates all stack traversal logic into a single source of truth.
 * All functions are pure and synchronous.
 */

import type { Branch, Commit, RebaseIntent, StackNodeState } from '@shared/types'

export class StackAnalyzer {
  // Prevent instantiation - use static methods
  private constructor() {}

  // ───────────────────────────────────────────────────────────────────────────
  // Tree Traversal
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Walks through all nodes in a stack tree, calling the visitor for each node.
   * Traversal is depth-first, parent before children.
   */
  public static walk(
    root: StackNodeState,
    visitor: (node: StackNodeState, depth: number) => void
  ): void {
    function doWalk(node: StackNodeState, depth: number): void {
      visitor(node, depth)
      for (const child of node.children) {
        doWalk(child, depth + 1)
      }
    }
    doWalk(root, 0)
  }

  /**
   * Flattens a StackNodeState tree into an array, depth-first order.
   */
  public static flatten(root: StackNodeState): StackNodeState[] {
    const result: StackNodeState[] = []
    StackAnalyzer.walk(root, (node) => {
      result.push(node)
    })
    return result
  }

  /**
   * Computes the maximum depth of a stack tree.
   * A single node has depth 1.
   */
  public static computeDepth(root: StackNodeState): number {
    let maxDepth = 0
    StackAnalyzer.walk(root, (_node, depth) => {
      maxDepth = Math.max(maxDepth, depth + 1)
    })
    return maxDepth
  }

  /**
   * Counts total nodes in a stack tree.
   */
  public static countNodes(root: StackNodeState): number {
    let count = 0
    StackAnalyzer.walk(root, () => {
      count++
    })
    return count
  }

  /**
   * Gets all branch names in a stack tree.
   */
  public static getBranches(root: StackNodeState): string[] {
    const branches: string[] = []
    StackAnalyzer.walk(root, (node) => {
      branches.push(node.branch)
    })
    return branches
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Node Finding
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Finds a node by branch name within a RebaseIntent's target trees.
   */
  public static findNodeByBranch(intent: RebaseIntent, branchName: string): StackNodeState | null {
    for (const target of intent.targets) {
      const found = StackAnalyzer.findInTree(target.node, branchName)
      if (found) {
        return found
      }
    }
    return null
  }

  /**
   * Finds a node by branch name within a single StackNodeState tree.
   */
  public static findInTree(root: StackNodeState, branchName: string): StackNodeState | null {
    if (root.branch === branchName) {
      return root
    }
    for (const child of root.children) {
      const found = StackAnalyzer.findInTree(child, branchName)
      if (found) {
        return found
      }
    }
    return null
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Commit Lineage
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Collects commit lineage from a head SHA, walking backwards through parents.
   * Returns SHAs in chronological order (oldest to newest).
   */
  public static collectLineage(
    headSha: string,
    commitMap: Map<string, Commit>,
    options: { stopAt?: string; maxDepth?: number } = {}
  ): string[] {
    const { stopAt, maxDepth = 1000 } = options
    const shas: string[] = []
    const visited = new Set<string>()
    let currentSha: string | null = headSha

    while (currentSha && !visited.has(currentSha) && shas.length < maxDepth) {
      if (stopAt && currentSha === stopAt) break
      visited.add(currentSha)
      shas.push(currentSha)
      const commit = commitMap.get(currentSha)
      if (!commit?.parentSha) break
      currentSha = commit.parentSha
    }

    // Return in chronological order (oldest to newest)
    return shas.slice().reverse()
  }

  /**
   * Walks backwards through commit history from a given SHA until a stopping condition is met.
   * Returns the SHAs visited in order (from head backwards).
   */
  public static walkCommitHistory(
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
   */
  public static countCommitsInRange(
    baseSha: string,
    headSha: string,
    commitMap: Map<string, Commit>
  ): number {
    if (baseSha === headSha) return 0

    const visited = StackAnalyzer.walkCommitHistory(headSha, commitMap, (commit, sha) => {
      return sha === baseSha || commit.parentSha === baseSha
    })

    const lastVisited = visited[visited.length - 1]
    if (lastVisited) {
      const lastCommit = commitMap.get(lastVisited)
      if (lastCommit?.parentSha === baseSha || lastVisited === baseSha) {
        return lastVisited === baseSha ? visited.length - 1 : visited.length
      }
    }

    return visited.length
  }

  /**
   * Gets commits in a range (exclusive of base, inclusive of head).
   * Returns commits in topological order (oldest to newest).
   */
  public static getCommitsInRange(
    baseSha: string,
    headSha: string,
    commitMap: Map<string, Commit>
  ): Commit[] {
    if (baseSha === headSha) return []

    const shas = StackAnalyzer.walkCommitHistory(headSha, commitMap, (_commit, sha) => {
      return sha === baseSha
    })

    const filtered = shas.filter((sha) => sha !== baseSha)

    return filtered
      .reverse()
      .map((sha) => commitMap.get(sha))
      .filter((c): c is Commit => c !== undefined)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Branch Analysis
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Builds an index mapping commit SHAs to branch names that point to them.
   */
  public static buildBranchHeadIndex(branches: Branch[]): Map<string, string[]> {
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
   * Builds an index mapping each branch to its nearest ancestor branch.
   *
   * Distance represents how many commits separate the branch head from its parent head.
   * Distance 0 means both branches point to the same commit (empty diff).
   */
  public static buildParentIndex(
    branches: Branch[],
    commitMap: Map<string, Commit>,
    options: { includeRemote?: boolean } = {}
  ): Map<string, { parent: string; distance: number }> {
    const { includeRemote = false } = options
    const branchByName = new Map(branches.map((branch) => [branch.ref, branch]))
    const eligibleBranches = includeRemote
      ? branches
      : branches.filter((branch) => !branch.isRemote)
    const headIndex = StackAnalyzer.buildBranchHeadIndex(eligibleBranches)

    const parentIndex = new Map<string, { parent: string; distance: number }>()

    for (const branch of eligibleBranches) {
      if (!branch.headSha) continue

      const parentInfo = StackAnalyzer.findNearestAncestorBranch(
        branch,
        headIndex,
        branchByName,
        commitMap
      )

      if (parentInfo) {
        parentIndex.set(branch.ref, parentInfo)
      }
    }

    return parentIndex
  }

  /**
   * Builds a reverse index mapping parent branch -> child branches.
   */
  public static buildChildrenIndex(
    parentIndex: Map<string, { parent: string; distance: number }>
  ): Map<string, string[]> {
    const childrenIndex = new Map<string, string[]>()

    for (const [child, { parent }] of parentIndex) {
      const existing = childrenIndex.get(parent) ?? []
      existing.push(child)
      childrenIndex.set(parent, existing)
    }

    return childrenIndex
  }

  /**
   * Collects descendants in a straight line from the given branch.
   *
   * Returns null if any branching is encountered.
   */
  public static collectLinearDescendants(
    branch: string,
    childrenIndex: Map<string, string[]>,
    maxDepth: number = 1000
  ): string[] | null {
    const result: string[] = []
    const visited = new Set<string>()
    let current = branch

    while (result.length < maxDepth) {
      if (visited.has(current)) {
        // Cycle detected
        return null
      }
      visited.add(current)

      const children = childrenIndex.get(current) ?? []
      if (children.length === 0) {
        break
      }
      if (children.length > 1) {
        // Branching encountered - not linear
        return null
      }

      const [child] = children
      result.push(child)
      current = child
    }

    return result
  }

  /**
   * Finds child branches that stem directly from a given parent commit.
   * A child branch is one whose head's parent is the parentHeadSha.
   */
  public static findDirectChildBranches(
    branches: Branch[],
    commitMap: Map<string, Commit>,
    parentHeadSha: string,
    options: { excludeRemote?: boolean; excludeTrunk?: boolean } = {}
  ): Branch[] {
    const { excludeRemote = true, excludeTrunk = true } = options

    return branches.filter((branch) => {
      if (excludeRemote && branch.isRemote) return false
      if (excludeTrunk && branch.isTrunk) return false
      if (branch.headSha === parentHeadSha) return false

      const commit = commitMap.get(branch.headSha)
      return commit?.parentSha === parentHeadSha
    })
  }

  private static findNearestAncestorBranch(
    branch: Branch,
    headIndex: Map<string, string[]>,
    branchByName: Map<string, Branch>,
    commitMap: Map<string, Commit>,
    maxDepth: number = 1000
  ): { parent: string; distance: number } | null {
    let distance = 0
    let currentSha: string | undefined = branch.headSha

    while (currentSha && distance <= maxDepth) {
      const candidates =
        headIndex.get(currentSha)?.filter((candidate) => candidate !== branch.ref) ?? []
      const parentBranch = StackAnalyzer.pickParentCandidate(candidates, branchByName)

      if (parentBranch) {
        return { parent: parentBranch.ref, distance }
      }

      const commit = commitMap.get(currentSha)
      if (!commit?.parentSha) break

      currentSha = commit.parentSha
      distance++
    }

    return null
  }

  private static pickParentCandidate(
    candidates: string[],
    branchByName: Map<string, Branch>
  ): Branch | null {
    const resolved = candidates
      .map((name) => branchByName.get(name))
      .filter((branch): branch is Branch => Boolean(branch))
      .sort((a, b) => {
        if (a.isTrunk === b.isTrunk) {
          return a.ref.localeCompare(b.ref)
        }
        // Prefer non-trunk parents when possible
        return a.isTrunk ? 1 : -1
      })

    return resolved[0] ?? null
  }
}
