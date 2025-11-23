import fs from 'fs'
import git from 'isomorphic-git'

export async function updateFileStageStatus(
  repoPath: string,
  files: string[],
  staged: boolean
): Promise<void> {
  if (staged) {
    await Promise.all(
      files.map((filepath) =>
        git.add({
          fs,
          dir: repoPath,
          filepath
        })
      )
    )
  } else {
    let hasHead = false
    try {
      await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
      hasHead = true
    } catch {
      hasHead = false
    }

    if (hasHead) {
      await Promise.all(
        files.map((filepath) =>
          git.resetIndex({
            fs,
            dir: repoPath,
            filepath
          })
        )
      )
    } else {
      // No HEAD (initial commit), use remove to unstage
      await Promise.all(
        files.map((filepath) =>
          git.remove({
            fs,
            dir: repoPath,
            filepath
          })
        )
      )
    }
  }
}
