import { useEffect } from 'react'

export function useGitWatcher({
  repoPath,
  onRepoChange
}: {
  repoPath: string | null
  onRepoChange: () => void
}): void {
  useEffect(() => {
    if (!repoPath) return

    void window.api.watchRepo({ repoPath })

    const cleanupListener = window.api.onRepoChange(() => {
      onRepoChange()
    })

    return () => {
      cleanupListener()
      void window.api.unwatchRepo({ repoPath })
    }
  }, [repoPath, onRepoChange])
}
