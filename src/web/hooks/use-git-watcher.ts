export function useGitWatcher(_: {
  repoPath: string | null
  onRepoChange: () => void
  onRepoError?: (error: string) => void
}): void {
  // Disabling this for now until we resolve all the UI blinking during complex operations
  // useEffect(() => {
  //   if (!repoPath) return
  //   void window.api.watchRepo({ repoPath })
  //   const cleanupListener = window.api.onRepoChange(() => {
  //     onRepoChange()
  //   })
  //   let cleanupErrorListener: (() => void) | undefined
  //   if (onRepoError) {
  //     cleanupErrorListener = window.api.onRepoError((error) => {
  //       onRepoError(error)
  //     })
  //   }
  //   return () => {
  //     cleanupListener()
  //     if (cleanupErrorListener) {
  //       cleanupErrorListener()
  //     }
  //     void window.api.unwatchRepo({ repoPath })
  //   }
  // }, [repoPath, onRepoChange, onRepoError])
}
