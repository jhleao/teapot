import type { BranchCollisionResolution, SquashPreview } from '@shared/types'
import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

type SquashConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: SquashPreview
  onConfirm: (
    commitMessage: string,
    branchResolution?: BranchCollisionResolution
  ) => Promise<void> | void
  isSubmitting?: boolean
}

type BranchResolutionOption = 'keep_parent' | 'keep_child' | 'keep_both' | 'new_name'

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
  const [branchResolution, setBranchResolution] = useState<BranchResolutionOption>('keep_parent')
  const [newBranchName, setNewBranchName] = useState('')

  useEffect(() => {
    if (open) {
      setCommitMessage(defaultCommitMessage)
      setBranchResolution('keep_parent')
      setNewBranchName('')
    }
  }, [open, defaultCommitMessage])

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()

    let resolution: BranchCollisionResolution | undefined

    if (preview.hasBranchCollision) {
      if (branchResolution === 'new_name') {
        resolution = { type: 'new_name', name: newBranchName.trim() }
      } else {
        resolution = { type: branchResolution }
      }
    }

    await onConfirm(commitMessage, resolution)
  }

  // Check if deleted branch has a PR
  const deletedBranchHasPr = useMemo(() => {
    if (!preview.hasBranchCollision) return false
    switch (branchResolution) {
      case 'keep_parent':
        return preview.targetHasPr
      case 'keep_child':
        return preview.parentHasPr
      case 'keep_both':
        return false
      case 'new_name':
        return preview.targetHasPr || preview.parentHasPr
    }
  }, [branchResolution, preview.hasBranchCollision, preview.targetHasPr, preview.parentHasPr])

  const deletedPrNumbers = useMemo(() => {
    if (!preview.hasBranchCollision) return null
    switch (branchResolution) {
      case 'keep_parent':
        return preview.targetPrNumber ? [preview.targetPrNumber] : null
      case 'keep_child':
        return preview.parentPrNumber ? [preview.parentPrNumber] : null
      case 'keep_both':
        return null
      case 'new_name': {
        const prs: number[] = []
        if (preview.targetPrNumber) prs.push(preview.targetPrNumber)
        if (preview.parentPrNumber) prs.push(preview.parentPrNumber)
        return prs.length > 0 ? prs : null
      }
    }
  }, [branchResolution, preview.hasBranchCollision, preview.targetPrNumber, preview.parentPrNumber])

  const isConfirmDisabled =
    isSubmitting ||
    (!preview.isEmpty && commitMessage.trim().length === 0) ||
    (branchResolution === 'new_name' && newBranchName.trim().length === 0)

  // Build the title
  const dialogTitle = useMemo(() => {
    if (preview.targetBranch && preview.parentBranch) {
      return `Squash ${preview.targetBranch} into ${preview.parentBranch}`
    }
    if (preview.targetBranch) {
      return `Squash ${preview.targetBranch} into parent`
    }
    return 'Squash into parent'
  }, [preview.targetBranch, preview.parentBranch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="px-6 py-5 sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="mt-4">
          <div className="space-y-5">
            {/* Commit message section */}
            {!preview.isEmpty && (
              <div className="space-y-2">
                <label className="text-muted-foreground text-sm">Combined commit message</label>
                <textarea
                  className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex w-full resize-none rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  rows={7}
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
            )}

            {preview.isEmpty && (
              <div className="text-muted-foreground text-sm">
                This commit&apos;s changes are already present in its parent.
                {preview.descendantBranches && preview.descendantBranches.length > 0 && (
                  <> Descendants will be rebased.</>
                )}
              </div>
            )}

            {/* Branch collision resolution section */}
            {preview.hasBranchCollision && (
              <div className="space-y-3">
                <p className="text-sm">
                  Both branches will point to the same commit.
                  <br />
                  Which branch name should be kept?
                </p>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="branchResolution"
                      value="keep_parent"
                      checked={branchResolution === 'keep_parent'}
                      onChange={() => setBranchResolution('keep_parent')}
                      disabled={isSubmitting}
                      className="accent-accent h-4 w-4"
                    />
                    <span className="text-sm">
                      Keep <span className="font-semibold">{preview.parentBranch}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        (delete child {preview.targetBranch})
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="branchResolution"
                      value="keep_child"
                      checked={branchResolution === 'keep_child'}
                      onChange={() => setBranchResolution('keep_child')}
                      disabled={isSubmitting}
                      className="accent-accent h-4 w-4"
                    />
                    <span className="text-sm">
                      Keep <span className="font-semibold">{preview.targetBranch}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        (delete parent {preview.parentBranch})
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="branchResolution"
                      value="keep_both"
                      checked={branchResolution === 'keep_both'}
                      onChange={() => setBranchResolution('keep_both')}
                      disabled={isSubmitting}
                      className="accent-accent h-4 w-4"
                    />
                    <span className="text-sm">Keep both branches</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="branchResolution"
                      value="new_name"
                      checked={branchResolution === 'new_name'}
                      onChange={() => setBranchResolution('new_name')}
                      disabled={isSubmitting}
                      className="accent-accent h-4 w-4"
                    />
                    <span className="text-sm">Rename to:</span>
                    <input
                      type="text"
                      placeholder="new-branch-name"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onFocus={() => setBranchResolution('new_name')}
                      disabled={isSubmitting}
                      className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex-1 rounded-md border px-3 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Descendants info */}
            {preview.descendantBranches &&
              preview.descendantBranches.length > 0 &&
              !preview.isEmpty && (
                <p className="text-muted-foreground text-sm">
                  Will rebase: {preview.descendantBranches.join(', ')}
                </p>
              )}

            {/* PR warning for deleted branch */}
            {deletedBranchHasPr && deletedPrNumbers && (
              <p className="text-destructive text-sm">
                {deletedPrNumbers.length === 1
                  ? `PR #${deletedPrNumbers[0]} will be closed`
                  : `PRs #${deletedPrNumbers.join(', #')} will be closed`}
              </p>
            )}

            {/* PR warning for non-collision case with target branch */}
            {!preview.hasBranchCollision && preview.targetHasPr && preview.targetBranch && (
              <p className="text-muted-foreground text-sm">
                PR #{preview.targetPrNumber} will be updated
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="border-border bg-background text-foreground hover:bg-muted rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isConfirmDisabled}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Squashing...' : 'Squash'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
