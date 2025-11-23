import fs from 'fs'
import git from 'isomorphic-git'

export async function deleteBranch(repoPath: string, branchName: string): Promise<void> {
  await git.deleteBranch({
    fs,
    dir: repoPath,
    ref: branchName
  })
}
