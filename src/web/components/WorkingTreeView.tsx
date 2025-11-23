import type { UiWorkingTreeFile } from '@shared/types'
import React, { useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { Checkbox, type CheckboxState } from './Checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './Dialog'
import { FileItem } from './FileItem'
import { CommitDot } from './SvgPaths'

function SelectAllToggle({
  files,
  onToggle
}: {
  files: UiWorkingTreeFile[]
  onToggle: () => void
}) {
  const stagedCount = files.filter(
    (file) => file.stageStatus === 'staged' || file.stageStatus === 'partially-staged'
  ).length
  const allStaged = stagedCount === files.length && files.length > 0
  const noneStaged = stagedCount === 0
  const someStaged = !allStaged && !noneStaged

  let checkboxState: CheckboxState = 'unchecked'
  if (allStaged) checkboxState = 'checked'
  else if (someStaged) checkboxState = 'indeterminate'

  return (
    <div className="mb-2 flex items-center gap-2">
      <Checkbox state={checkboxState} onClick={onToggle} />
      <span className="text-muted-foreground text-sm">
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </span>
    </div>
  )
}

// ============================================================================
// Commit Form Components
// ============================================================================

function CommitForm({
  message,
  onMessageChange,
  onCommit,
  onAmend,
  onDiscard,
  canCommit
}: {
  message: string
  onMessageChange: (message: string) => void
  onCommit: () => void
  onAmend: () => void
  onDiscard: () => void
  canCommit: boolean
}) {
  function CommitFormButton({
    onClick,
    children,
    className,
    disabled
  }: {
    onClick: () => void
    children: React.ReactNode
    className?: string
    disabled?: boolean
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'border-border bg-muted text-foreground hover:bg-muted/80 border px-3 py-2 text-sm transition-opacity disabled:pointer-events-none disabled:opacity-50',
          className
        )}
      >
        {children}
      </button>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <input
        type="text"
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="Commit message"
        className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-accent rounded border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
      />
      <div className="ml-auto flex items-center">
        <CommitFormButton
          onClick={onCommit}
          disabled={!canCommit}
          className="z-10 rounded-l-md border-y border-l"
        >
          Commit
        </CommitFormButton>
        <CommitFormButton
          onClick={onAmend}
          disabled={!canCommit}
          className="rounded-none border-l-0"
        >
          Amend
        </CommitFormButton>
        <CommitFormButton onClick={onDiscard} className="rounded-l-none rounded-r-md border-l-0">
          Discard
        </CommitFormButton>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkingTreeView({
  files,
  className
}: {
  files: UiWorkingTreeFile[]
  className?: string
}): React.JSX.Element {
  const [commitMessage, setCommitMessage] = useState('')
  const { setFilesStageStatus, commit, amend, discardStaged } = useUiStateContext()
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false)

  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))

  // ============================================================================
  // Staging Handlers
  // ============================================================================

  const handleFileToggle = async (file: UiWorkingTreeFile): Promise<void> => {
    // If it's staged (fully), we unstage.
    // If it's unstaged or partially staged, we stage (fully).
    const shouldStage = file.stageStatus !== 'staged'

    await setFilesStageStatus({
      staged: shouldStage,
      files: [file.path]
    })
  }

  const handleSelectAllToggle = async (): Promise<void> => {
    const stagedCount = sortedFiles.filter(
      (file) => file.stageStatus === 'staged' || file.stageStatus === 'partially-staged'
    ).length
    const allStaged = stagedCount === sortedFiles.length && sortedFiles.length > 0

    if (allStaged) {
      // Unstage all
      await setFilesStageStatus({
        staged: false,
        files: sortedFiles.map((file) => file.path)
      })
    } else {
      // Stage all (including partially staged)
      // We want to stage everything that isn't fully staged
      const filesToStage = sortedFiles
        .filter((file) => file.stageStatus !== 'staged')
        .map((file) => file.path)

      await setFilesStageStatus({
        staged: true,
        files: filesToStage
      })
    }
  }

  // ============================================================================
  // Commit Handlers
  // ============================================================================

  const handleCommit = async (): Promise<void> => {
    if (!commitMessage.trim()) return
    await commit({ message: commitMessage })
    setCommitMessage('')
  }

  const handleAmend = async (): Promise<void> => {
    await amend({ message: commitMessage })
    setCommitMessage('')
  }

  const handleDiscardClick = (): void => {
    if (files.length === 0) return
    setIsDiscardDialogOpen(true)
  }

  const handleConfirmDiscard = async (): Promise<void> => {
    await discardStaged()
    setCommitMessage('')
    setIsDiscardDialogOpen(false)
  }

  const hasStagedChanges = files.some(
    (file) => file.stageStatus === 'staged' || file.stageStatus === 'partially-staged'
  )
  const canCommit = hasStagedChanges && commitMessage.trim() !== ''

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={cn('bg-muted/50 flex w-full items-stretch rounded-lg', className)}>
      <div className="flex h-auto w-[26px] flex-col items-center">
        <CommitDot bottom variant="accent" accentLines="bottom" />
        <div className="bg-accent w-[2px] flex-1" />
      </div>
      <div className="flex flex-1 flex-col py-3 pr-3">
        <div className="text-muted-foreground mb-2 text-sm font-semibold">Working Tree</div>
        <SelectAllToggle files={sortedFiles} onToggle={handleSelectAllToggle} />
        <div className="flex flex-col gap-2">
          {sortedFiles.map((file, index) => (
            <FileItem key={`${file.path}-${index}`} file={file} onToggle={handleFileToggle} />
          ))}
        </div>
        <CommitForm
          message={commitMessage}
          onMessageChange={setCommitMessage}
          onCommit={handleCommit}
          onAmend={handleAmend}
          onDiscard={handleDiscardClick}
          canCommit={canCommit}
        />
      </div>

      <Dialog open={isDiscardDialogOpen} onOpenChange={setIsDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard Changes?</DialogTitle>
            <DialogDescription>
              Are you sure you want to discard all changes? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setIsDiscardDialogOpen(false)}
              className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDiscard}
              className="bg-error hover:bg-error/90 rounded border border-transparent px-3 py-1 text-sm text-white transition-colors"
            >
              Discard Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
