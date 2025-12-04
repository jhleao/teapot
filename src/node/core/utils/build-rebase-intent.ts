import { Branch, Commit, RebaseIntent, Repo, StackNodeState } from '@shared/types'

export function buildRebaseIntent(
  repo: Repo,
  headSha: string,
  baseSha: string
): RebaseIntent | null {
  const commitMap = new Map<string, Commit>(repo.commits.map((commit) => [commit.sha, commit]))
  if (!commitMap.has(headSha) || !commitMap.has(baseSha)) {
    return null
  }

  const node = buildStackNodeState(repo, commitMap, headSha, new Set())
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

function buildStackNodeState(
  repo: Repo,
  commitMap: Map<string, Commit>,
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
  const children: StackNodeState[] = []
  findChildBranches(repo.branches, commitMap, headSha).forEach((branch) => {
    const childNode = buildStackNodeState(repo, commitMap, branch.headSha, visited)
    if (childNode) {
      children.push(childNode)
    }
  })
  visited.delete(headSha)

  return {
    branch: branchName,
    headSha,
    baseSha: commit.parentSha,
    children
  }
}

function selectBranchName(branches: Branch[], headSha: string): string | null {
  const localBranch = branches.find(
    (branch) => branch.headSha === headSha && !branch.isRemote && !branch.isTrunk
  )
  if (localBranch) {
    return localBranch.ref
  }
  const fallbackLocal = branches.find((branch) => branch.headSha === headSha && !branch.isRemote)
  if (fallbackLocal) {
    return fallbackLocal.ref
  }
  const anyBranch = branches.find((branch) => branch.headSha === headSha)
  return anyBranch?.ref ?? null
}

function findChildBranches(
  branches: Branch[],
  commitMap: Map<string, Commit>,
  parentHeadSha: string
): Branch[] {
  return branches.filter((branch) => {
    if (branch.isRemote || branch.isTrunk || branch.headSha === parentHeadSha) {
      return false
    }
    const commit = commitMap.get(branch.headSha)
    return commit?.parentSha === parentHeadSha
  })
}
