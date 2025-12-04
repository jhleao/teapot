import { getGitAdapter } from '../git-adapter'

export async function deleteBranch(repoPath: string, branchName: string): Promise<void> {
  const git = getGitAdapter()
  await git.deleteBranch(repoPath, branchName)
}
