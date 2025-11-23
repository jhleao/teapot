import fs from 'fs'
import git from 'isomorphic-git'
import { generateRandomBranchName } from './branch-name'
import { getAuthorIdentity } from './get-author-identity'

export async function commitToNewBranch(
  repoPath: string,
  message: string,
  newBranchName?: string
): Promise<void> {
  const dir = repoPath
  const currentBranch = await git.currentBranch({ fs, dir, fullname: false })

  if (!currentBranch) throw new Error('Cannot commit from detached HEAD state')

  const author = await getAuthorIdentity(dir)

  let branchName = newBranchName
  if (!branchName) branchName = generateRandomBranchName(author.name)

  await git.branch({
    fs,
    dir,
    ref: branchName,
    checkout: true
  })

  await git.commit({
    fs,
    dir,
    message,
    author,
    committer: author
  })
}
