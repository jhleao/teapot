import { useDragContext } from '../contexts/DragContext'

export function DragCursor(): React.JSX.Element | null {
  const { mousePosition, draggedBranchCount, draggingCommitSha } = useDragContext()

  if (!mousePosition || !draggingCommitSha) return null

  return (
    <div
      className="bg-accent text-accent-foreground animate-in fade-in zoom-in-10 pointer-events-none fixed z-50 flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-2 text-xs font-medium shadow-lg"
      style={{ left: mousePosition.x, top: mousePosition.y }}
    >
      {draggedBranchCount > 0 ? draggedBranchCount : '↑'}
    </div>
  )
}
