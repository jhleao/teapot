import { getGitAdapter } from '../git-adapter'
import { generateRandomBranchName } from './branch-name'
import { getAuthorIdentity } from './get-author-identity'

export async function commitToNewBranch(
  repoPath: string,
  message: string,
  newBranchName?: string
): Promise<void> {
  const git = getGitAdapter()
  const currentBranch = await git.currentBranch(repoPath)

  if (!currentBranch) throw new Error('Cannot commit from detached HEAD state')

  const author = await getAuthorIdentity(repoPath)

  let branchName = newBranchName
  if (!branchName) branchName = generateRandomBranchName(author.name)

  await git.branch(repoPath, branchName, { checkout: true })

  await git.commit(repoPath, {
    message,
    author: {
      name: author.name,
      email: author.email
    },
    committer: {
      name: author.name,
      email: author.email
    }
  })
}
