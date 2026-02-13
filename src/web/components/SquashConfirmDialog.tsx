import type { BranchChoice, SquashPreview } from '@shared/types'
import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog'

type SquashConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: SquashPreview
  onConfirm: (commitMessage: string, branchChoice?: BranchChoice) => Promise<void> | void
  isSubmitting?: boolean
}

function RadioButton({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <div
      className={`h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${
        checked ? 'border-accent bg-accent' : 'border-muted-foreground/50 bg-transparent'
      } ${disabled ? 'opacity-50' : ''} flex items-center justify-center`}
    >
      {checked && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
    </div>
  )
}

export function SquashConfirmDialog({
  open,
  onOpenChange,
  preview,
  onConfirm,
  isSubmitting = false
}: SquashConfirmDialogProps): React.JSX.Element {
  const defaultCommitMessage = useMemo(() => {
    const parent = preview.parentCommitMessage ?? ''
    const child = preview.commitMessage ?? ''
    if (!parent && !child) return ''
    if (!parent) return child
    if (!child) return parent
    return `${parent}\n\n---\n\n${child}`
  }, [preview.commitMessage, preview.parentCommitMessage])

  const [commitMessage, setCommitMessage] = useState(defaultCommitMessage)
  const [branchChoice, setBranchChoice] = useState<BranchChoice>('parent')
  const [customBranchName, setCustomBranchName] = useState('')

  const hasBranchCollision = preview.branchCollision != null

  useEffect(() => {
    if (open) {
      setCommitMessage(defaultCommitMessage)
      setBranchChoice('parent')
      setCustomBranchName('')
    }
  }, [open, defaultCommitMessage])

  const handleConfirm = async () => {
    if (preview.resultWouldBeEmpty) {
      // No commit message or branch choice needed — both branches will be removed
      await onConfirm('')
      return
    }
    const finalBranchChoice = branchChoice === 'new' ? customBranchName : branchChoice
    await onConfirm(commitMessage, hasBranchCollision ? finalBranchChoice : undefined)
  }

  // Determine if confirm button should be disabled
  const isConfirmDisabled =
    isSubmitting ||
    (!preview.isEmpty && !preview.resultWouldBeEmpty && commitMessage.trim().length === 0) ||
    (branchChoice === 'new' && customBranchName.trim().length === 0)

  let buttonLabel: string
  if (isSubmitting) {
    buttonLabel = preview.resultWouldBeEmpty ? 'Removing...' : 'Squashing...'
  } else {
    buttonLabel = preview.resultWouldBeEmpty ? 'Remove Branches' : 'Squash'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {preview.resultWouldBeEmpty
              ? `Remove ${preview.targetBranch} and ${preview.parentBranch}`
              : `Squash ${preview.targetBranch} into ${preview.parentBranch}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {preview.resultWouldBeEmpty && (
            <div className="rounded-md border border-amber-200 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500 dark:text-amber-200">
              <div className="font-medium">Changes cancel out</div>
              <div className="mt-1">
                The changes in{' '}
                <span className="font-semibold">{preview.targetBranch}</span> undo the changes in{' '}
                <span className="font-semibold">{preview.parentBranch}</span>. Both branches will
                be removed.
              </div>
            </div>
          )}

          {!preview.isEmpty && !preview.resultWouldBeEmpty && (
            <div className="space-y-3">
              <h4 className="text-sm leading-none font-medium">Combined commit message</h4>
              <textarea
                className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex w-full resize-none rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                rows={8}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          )}

          {preview.isEmpty && (
            <div className="bg-muted text-foreground border-border rounded-md border px-3 py-2.5 text-sm">
              This branch&apos;s changes are already present in{' '}
              <span className="font-semibold">{preview.parentBranch}</span>. Descendants will be
              rebased.
            </div>
          )}

          {hasBranchCollision && !preview.resultWouldBeEmpty && (
            <div className="space-y-4">
              <div className="text-foreground text-sm">
                Both branches will point to the same commit.
                <br />
                Which branch name should be kept?
              </div>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="branchChoice"
                    value="parent"
                    checked={branchChoice === 'parent'}
                    onChange={() => setBranchChoice('parent')}
                    disabled={isSubmitting}
                    className="sr-only"
                  />
                  <RadioButton checked={branchChoice === 'parent'} disabled={isSubmitting} />
                  <span className="text-sm">
                    Keep{' '}
                    <span className="font-semibold">{preview.branchCollision?.existingBranch}</span>{' '}
                    <span className="text-muted-foreground">
                      (delete child {preview.branchCollision?.childBranch})
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="branchChoice"
                    value="child"
                    checked={branchChoice === 'child'}
                    onChange={() => setBranchChoice('child')}
                    disabled={isSubmitting}
                    className="sr-only"
                  />
                  <RadioButton checked={branchChoice === 'child'} disabled={isSubmitting} />
                  <span className="text-sm">
                    Keep{' '}
                    <span className="font-semibold">{preview.branchCollision?.childBranch}</span>{' '}
                    <span className="text-muted-foreground">
                      (delete parent {preview.branchCollision?.existingBranch})
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="branchChoice"
                    value="both"
                    checked={branchChoice === 'both'}
                    onChange={() => setBranchChoice('both')}
                    disabled={isSubmitting}
                    className="sr-only"
                  />
                  <RadioButton checked={branchChoice === 'both'} disabled={isSubmitting} />
                  <span className="text-sm">Keep both branches</span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="branchChoice"
                    value="new"
                    checked={branchChoice === 'new'}
                    onChange={() => setBranchChoice('new')}
                    disabled={isSubmitting}
                    className="sr-only"
                  />
                  <RadioButton checked={branchChoice === 'new'} disabled={isSubmitting} />
                  <span className="text-sm">Rename to:</span>
                  <input
                    type="text"
                    value={customBranchName}
                    onChange={(e) => setCustomBranchName(e.target.value)}
                    onFocus={() => setBranchChoice('new')}
                    placeholder="new-branch-name"
                    disabled={isSubmitting}
                    className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex-1 rounded-md border px-3 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </div>
            </div>
          )}

          {preview.descendantBranches && preview.descendantBranches.length > 0 && (
            <div className="bg-muted/40 text-foreground border-border rounded-md border px-3 py-2.5 text-sm">
              <div className="font-medium">Will rebase</div>
              <div className="text-muted-foreground mt-1">
                {preview.descendantBranches.join(', ')}
              </div>
            </div>
          )}

          {preview.hasPr && branchChoice !== 'child' && branchChoice !== 'both' && (
            <div className="rounded-md border border-amber-200 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500 dark:text-amber-200">
              Will close PR #{preview.prNumber} for {preview.targetBranch}.
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-1.5 sm:gap-1.5">
          <button
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
