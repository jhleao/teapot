import { getGitAdapter } from '../git-adapter'
import { getAuthorIdentity } from './get-author-identity'

export async function amend(repoPath: string, message?: string): Promise<void> {
  const git = getGitAdapter()

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
}
