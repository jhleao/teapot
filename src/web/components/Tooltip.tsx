import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import React, { createContext, useContext } from 'react'
import { cn } from '../utils/cn'

interface TooltipProps {
  children: React.ReactNode
  content: React.ReactNode
  /** Delay in ms before showing tooltip. Defaults to 0 for instant feedback. */
  delayDuration?: number
  /** Side to show tooltip on. Defaults to 'top'. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Whether the tooltip is disabled (won't show). */
  disabled?: boolean
}

/**
 * Context for tooltip portal container. When tooltips are rendered inside
 * another portal (like a context menu), they need to portal to that container
 * to maintain proper z-index stacking.
 */
const TooltipContainerContext = createContext<HTMLElement | null>(null)

export function TooltipContainerProvider({
  children,
  container
}: {
  children: React.ReactNode
  container: HTMLElement | null
}) {
  return (
    <TooltipContainerContext.Provider value={container}>
      {children}
    </TooltipContainerContext.Provider>
  )
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={0}>{children}</TooltipPrimitive.Provider>
}

export function Tooltip({
  children,
  content,
  delayDuration = 0,
  side = 'top',
  disabled
}: TooltipProps) {
  const container = useContext(TooltipContainerContext)

  if (disabled || !content) {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={container ?? undefined}>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className={cn(
            'z-[60] rounded-md border border-border px-2 py-1 text-xs shadow-md',
            'bg-popover text-popover-foreground',
            'animate-in fade-in-0 zoom-in-95'
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-popover" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
