import fs from 'fs'
import git from 'isomorphic-git'

export async function checkout(repoPath: string, ref: string): Promise<void> {
  await git.checkout({
    fs,
    dir: repoPath,
    ref
  })
}
