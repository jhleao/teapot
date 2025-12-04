import { getGitAdapter } from './git-adapter'

export async function updateFileStageStatus(
  repoPath: string,
  files: string[],
  staged: boolean
): Promise<void> {
  const git = getGitAdapter()

  if (staged) {
    await Promise.all(files.map((filepath) => git.add(repoPath, filepath)))
  } else {
    let hasHead = false
    try {
      await git.resolveRef(repoPath, 'HEAD')
      hasHead = true
    } catch {
      hasHead = false
    }

    if (hasHead) {
      await Promise.all(files.map((filepath) => git.resetIndex(repoPath, filepath)))
    } else {
      // No HEAD (initial commit), use remove to unstage
      await Promise.all(files.map((filepath) => git.remove(repoPath, filepath)))
    }
  }
}
