import { Settings } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { ConflictResolutionDialog } from './components/ConflictResolutionDialog'
import { EmptyState } from './components/EmptyState'
import { ResumeQueueDialog } from './components/ResumeQueueDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { StackView } from './components/StackView'
import { TitleBar } from './components/TitleBar'
import { Toaster } from './components/Toaster'
import { TooltipProvider } from './components/Tooltip'
import { Topbar } from './components/Topbar'
import { WorktreeConflictBanner } from './components/WorktreeConflictBanner'
import { ScrollArea, ScrollBar } from './components/ui/scroll-area'
import { useForgeStateContext } from './contexts/ForgeStateContext'
import { useLocalStateContext } from './contexts/LocalStateContext'
import { useScrollViewport } from './contexts/ScrollViewportContext'
import { useUiStateContext } from './contexts/UiStateContext'
import { useUpdateNotifications } from './hooks/use-update-notifications'
import { enrichStackWithForge } from './utils/enrich-stack-with-forge'

function App(): React.JSX.Element {
  const {
    uiState,
    repoError,
    isCurrentWorktreeConflicted,
    conflictedWorktrees,
    queuedBranches,
    switchWorktree
  } = useUiStateContext()
  const { forgeState } = useForgeStateContext()
  const { selectedRepo, addRepo } = useLocalStateContext()
  const { setViewportRef } = useScrollViewport()
  useUpdateNotifications()

  // Merge forge state (PR data) into the UI stack at render time
  // This allows local data to display immediately while forge state loads asynchronously
  const enrichedStack = useMemo(
    () => enrichStackWithForge(uiState?.stack ?? null, forgeState),
    [uiState?.stack, forgeState]
  )
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const handleAddRepo = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      await addRepo(selectedPath)
    }
  }

  // Filter to only show banner for worktrees that are NOT the current one
  // (current worktree conflicts show the modal instead)
  const currentWorktreePath = selectedRepo?.activeWorktreePath ?? selectedRepo?.path ?? null
  const nonCurrentConflictedWorktrees = conflictedWorktrees.filter(
    (wt) => wt.path !== currentWorktreePath
  )

  const handleSwitchToWorktree = (worktreePath: string): void => {
    switchWorktree({ worktreePath })
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col" data-testid="app-container">
        <ScrollArea className="flex-1" viewportRef={setViewportRef}>
          <div
            className="sticky top-0 z-10 backdrop-blur-lg"
            style={{ backgroundColor: 'color-mix(in srgb, var(--background) 70%, transparent)' }}
          >
            <TitleBar />
            <div className="px-6 py-2">
              <Topbar />
            </div>
            {/* Non-blocking banner for conflicts in non-current worktrees */}
            {nonCurrentConflictedWorktrees.length > 0 && (
              <WorktreeConflictBanner
                conflictedWorktrees={nonCurrentConflictedWorktrees}
                onSwitchToWorktree={handleSwitchToWorktree}
              />
            )}
          </div>
          <div className="px-6 pt-4 pb-32">
            {!selectedRepo ? (
              <EmptyState variant="no-repo" onAction={handleAddRepo} />
            ) : repoError ? (
              <EmptyState variant="error" errorMessage={repoError} />
            ) : enrichedStack ? (
              <StackView data={enrichedStack} workingTree={uiState?.workingTree ?? []} />
            ) : (
              <EmptyState variant="loading" />
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="focus:ring-foreground bg-secondary text-secondary-foreground hover:bg-secondary/80 fixed right-6 bottom-6 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full shadow-lg transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
          aria-label="Settings"
          data-testid="settings-button"
        >
          <Settings className="h-5 w-5" />
        </button>

        <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
        {/* Blocking modal only for current worktree conflicts */}
        {isCurrentWorktreeConflicted && <ConflictResolutionDialog />}
        {queuedBranches.length > 0 && !isCurrentWorktreeConflicted && (
          <ResumeQueueDialog queuedBranches={queuedBranches} />
        )}
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

export default App
