import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import React, { useCallback, useState } from 'react'
import { cn } from '../utils/cn'
import { Tooltip, TooltipContainerProvider } from './Tooltip'

interface ContextMenuProps {
  children: React.ReactNode
  content: React.ReactNode
  disabled?: boolean
}

export function ContextMenu({ children, content, disabled }: ContextMenuProps) {
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null)

  const menuRef = useCallback((node: HTMLDivElement | null) => {
    setMenuElement(node)
  }, [])

  if (disabled) {
    return <>{children}</>
  }

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <span className="contents">{children}</span>
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          ref={menuRef}
          className={cn(
            'z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md',
            'border-border bg-popover text-popover-foreground',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TooltipContainerProvider container={menuElement}>{content}</TooltipContainerProvider>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}

export function ContextMenuItem({
  children,
  onClick,
  className,
  disabled,
  disabledReason
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
  /** Tooltip explaining why the item is disabled. Only shown when disabled=true. */
  disabledReason?: string
}) {
  const item = (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={() => {
        if (!disabled) {
          onClick?.()
        }
      }}
      className={cn(
        'relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        !disabled && 'focus:bg-accent focus:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      {children}
    </ContextMenuPrimitive.Item>
  )

  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason} side="left">
        {item}
      </Tooltip>
    )
  }

  return item
}

export function ContextMenuSeparator({ className }: { className?: string }) {
  return (
    <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} />
  )
}
