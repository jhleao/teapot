import { getGitAdapter } from '../git-adapter'

export async function checkout(repoPath: string, ref: string): Promise<void> {
  const git = getGitAdapter()
  await git.checkout(repoPath, ref)
}
