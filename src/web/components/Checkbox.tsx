import { Check, Loader2, Minus, Square } from 'lucide-react'

export type CheckboxState = 'checked' | 'unchecked' | 'indeterminate'

export function Checkbox({
  state,
  onClick,
  isLoading
}: {
  state: CheckboxState
  onClick: () => void
  isLoading?: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex h-5 w-5 items-center justify-center">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <button onClick={onClick} className="cursor-pointer" type="button">
      {state === 'checked' && (
        <div className="relative">
          <Square className="fill-accent text-accent h-5 w-5" />
          <Check
            className="text-accent-foreground absolute top-[2px] left-[2px] h-3.5 w-3.5"
            strokeWidth={3}
          />
        </div>
      )}
      {state === 'indeterminate' && (
        <div className="relative">
          <Square className="fill-muted text-muted-foreground h-5 w-5" />
          <Minus
            className="text-muted-foreground absolute top-[5px] left-[5px] h-2.5 w-2.5"
            strokeWidth={4}
          />
        </div>
      )}
      {state === 'unchecked' && <Square className="text-muted-foreground h-5 w-5" />}
    </button>
  )
}
