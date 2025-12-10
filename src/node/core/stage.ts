import { getGitAdapter } from './git-adapter'

export async function updateFileStageStatus(
  repoPath: string,
  files: string[],
  staged: boolean
): Promise<void> {
  const git = getGitAdapter()

  if (staged) {
    await git.add(repoPath, files)
  } else {
    let hasHead = false
    try {
      await git.resolveRef(repoPath, 'HEAD')
      hasHead = true
    } catch {
      hasHead = false
    }

    if (hasHead) {
      await git.resetIndex(repoPath, files)
    } else {
      // No HEAD (initial commit), use remove to unstage
      await git.remove(repoPath, files)
    }
  }
}
