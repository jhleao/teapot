import { Ban, GitBranch, Loader2 } from 'lucide-react'
import { useDragContext } from '../contexts/DragContext'

export function DragCursor(): React.JSX.Element | null {
  const {
    mousePosition,
    draggedBranchCount,
    draggingCommitSha,
    targetLabel,
    isRebaseLoading,
    pendingRebase
  } = useDragContext()

  if (mousePosition && draggingCommitSha) {
    const isValidTarget = targetLabel !== null

    return (
      <div
        className={`animate-in fade-in zoom-in-10 pointer-events-none fixed z-50 flex h-7 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-medium shadow-lg ${
          isValidTarget ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
        }`}
        style={{ left: mousePosition.x, top: mousePosition.y }}
      >
        {isValidTarget ? (
          <>
            <span>
              rebase <span className="font-bold">{draggedBranchCount}</span>{' '}
              {draggedBranchCount === 1 ? 'branch' : 'branches'} on
            </span>
            <GitBranch className="h-3 w-3" />
            <span className="font-bold">{targetLabel}</span>
          </>
        ) : (
          <Ban className="h-3.5 w-3.5" />
        )}
      </div>
    )
  }

  if (isRebaseLoading && pendingRebase) {
    return (
      <div
        className="bg-accent text-accent-foreground animate-in fade-in pointer-events-none fixed z-50 flex h-7 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-medium shadow-lg"
        style={{ left: pendingRebase.cursorPosition.x, top: pendingRebase.cursorPosition.y }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>
          rebase <span className="font-bold">{pendingRebase.draggedBranchCount}</span>{' '}
          {pendingRebase.draggedBranchCount === 1 ? 'branch' : 'branches'} on
        </span>
        <GitBranch className="h-3 w-3" />
        <span className="font-bold">{pendingRebase.targetBranchName}</span>
      </div>
    )
  }

  return null
}
