import type { UiWorkingTreeFile } from '@shared/types'
import React, { useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { Checkbox, type CheckboxState } from './Checkbox'
import { FileItem } from './FileItem'
import { CommitDot } from './SvgPaths'

function SelectAllToggle({
  files,
  onToggle
}: {
  files: UiWorkingTreeFile[]
  onToggle: () => void
}) {
  const stagedCount = files.filter((file) => file.isStaged).length
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
  onDiscard
}: {
  message: string
  onMessageChange: (message: string) => void
  onCommit: () => void
  onAmend: () => void
  onDiscard: () => void
}) {
  function CommitFormButton({
    onClick,
    children,
    className
  }: {
    onClick: () => void
    children: React.ReactNode
    className?: string
  }) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors',
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
      <div className="ml-auto flex gap-2">
        <CommitFormButton onClick={onDiscard}>Discard</CommitFormButton>
        <CommitFormButton onClick={onAmend}>Amend</CommitFormButton>
        <CommitFormButton
          onClick={onCommit}
          className="bg-accent text-accent-foreground hover:bg-accent/90 border-0"
        >
          Commit
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
  const { setUiState } = useUiStateContext()

  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))

  // ============================================================================
  // Staging Handlers
  // ============================================================================

  const handleFileToggle = async (file: UiWorkingTreeFile): Promise<void> => {
    const newUiState = await window.api.setFilesStageStatus({
      staged: !file.isStaged,
      files: [file.path]
    })
    setUiState(newUiState)
  }

  const handleSelectAllToggle = async (): Promise<void> => {
    const stagedCount = sortedFiles.filter((file) => file.isStaged).length
    const allStaged = stagedCount === sortedFiles.length && sortedFiles.length > 0

    if (allStaged) {
      // Unstage all
      const newUiState = await window.api.setFilesStageStatus({
        staged: false,
        files: sortedFiles.map((file) => file.path)
      })
      setUiState(newUiState)
    } else {
      // Stage all remaining unstaged files
      const unstagedPaths = sortedFiles.filter((file) => !file.isStaged).map((file) => file.path)
      const newUiState = await window.api.setFilesStageStatus({
        staged: true,
        files: unstagedPaths
      })
      setUiState(newUiState)
    }
  }

  // ============================================================================
  // Commit Handlers
  // ============================================================================

  const handleCommit = async (): Promise<void> => {
    if (!commitMessage.trim()) return
    const newUiState = await window.api.commit({ message: commitMessage })
    setUiState(newUiState)
    setCommitMessage('')
  }

  const handleAmend = async (): Promise<void> => {
    if (!commitMessage.trim()) return
    const newUiState = await window.api.amend({ message: commitMessage })
    setUiState(newUiState)
    setCommitMessage('')
  }

  const handleDiscard = async (): Promise<void> => {
    const newUiState = await window.api.discardStaged()
    setUiState(newUiState)
    setCommitMessage('')
  }

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
          onDiscard={handleDiscard}
        />
      </div>
    </div>
  )
}
