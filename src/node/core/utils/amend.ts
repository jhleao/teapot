import fs from 'fs'
import git from 'isomorphic-git'
import { getAuthorIdentity } from './get-author-identity'

export async function amend(repoPath: string, message?: string): Promise<void> {
  const dir = repoPath

  const headCommitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })

  const { commit: headCommit } = await git.readCommit({ fs, dir, oid: headCommitOid })

  const currentIdentity = await getAuthorIdentity(dir)

  const author = {
    name: headCommit.author.name,
    email: headCommit.author.email,
    timestamp: headCommit.author.timestamp,
    timezoneOffset: headCommit.author.timezoneOffset
  }

  const committer = {
    name: currentIdentity.name,
    email: currentIdentity.email
  }

  await git.commit({
    fs,
    dir,
    message: message || headCommit.message,
    author,
    committer,
    parent: headCommit.parent
  })
}
