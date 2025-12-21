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
}
