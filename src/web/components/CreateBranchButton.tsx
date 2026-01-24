import { Loader2 } from 'lucide-react'
import React, { memo, useCallback, useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'

export const CreateBranchButton = memo(function CreateBranchButton({
  commitSha
}: {
  commitSha: string
}): React.JSX.Element {
  const { createBranch } = useUiStateContext()
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isLoading) return
      setIsLoading(true)
      try {
        await createBranch({ commitSha })
      } finally {
        setIsLoading(false)
      }
    },
    [createBranch, commitSha, isLoading]
  )

  return (
    <span
      onClick={handleClick}
      className={`bg-muted/50 text-muted-foreground/70 border-border/50 inline-flex items-center rounded-md border border-dashed px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors select-none ${
        isLoading ? 'cursor-wait opacity-70' : 'hover:bg-muted cursor-pointer'
      }`}
    >
      {isLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {isLoading ? 'Creating...' : 'Create branch'}
    </span>
  )
})
