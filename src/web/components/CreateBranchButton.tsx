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
      className={`bg-warning text-warning-foreground border-warning-border inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors select-none ${
        isLoading ? 'cursor-wait opacity-70' : 'hover:bg-warning-hover cursor-pointer'
      }`}
    >
      {isLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {isLoading ? 'Creating...' : 'Create branch'}
    </span>
  )
})
