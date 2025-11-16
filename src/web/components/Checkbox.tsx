import { Check, Minus, Square } from 'lucide-react'
import React from 'react'

export type CheckboxState = 'checked' | 'unchecked' | 'indeterminate'

export function Checkbox({ state, onClick }: { state: CheckboxState; onClick: () => void }) {
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
          <Square className="fill-accent text-accent h-5 w-5" />
          <Minus
            className="text-accent-foreground absolute top-[2px] left-[2px] h-3.5 w-3.5"
            strokeWidth={3}
          />
        </div>
      )}
      {state === 'unchecked' && <Square className="text-muted-foreground h-5 w-5" />}
    </button>
  )
}

