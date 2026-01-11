import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'
import { Tooltip, TooltipContainerProvider } from './Tooltip'

interface ContextMenuProps {
  children: React.ReactNode
  content: React.ReactNode
  disabled?: boolean
}

export function ContextMenu({ children, content, disabled }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  // Use state instead of ref to trigger re-render when element is attached
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null)

  const menuRef = useCallback((node: HTMLDivElement | null) => {
    setMenuElement(node)
  }, [])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (disabled) return

    e.preventDefault()
    e.stopPropagation()
    setPosition({ x: e.clientX, y: e.clientY })
  }

  const close = () => setPosition(null)

  return (
    <>
      <span onContextMenu={handleContextMenu} className="contents">
        {children}
      </span>
      {position && (
        <ContextMenuPortal>
          <ContextMenuOverlay onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            className={cn(
              'bg-popover text-popover-foreground animate-in fade-in zoom-in-95 fixed z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md',
              'border-border bg-background'
            )}
            style={{ top: position.y, left: position.x }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              // Close on item click
              close()
            }}
          >
            <TooltipContainerProvider container={menuElement}>{content}</TooltipContainerProvider>
          </div>
        </ContextMenuPortal>
      )}
    </>
  )
}

function ContextMenuPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

function ContextMenuOverlay({ onClick }: { onClick: () => void }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClick()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClick])

  return (
    <div
      className="fixed inset-0 z-40"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onClick()
      }}
    />
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
    <div
      role="menuitem"
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return
        // Don't stop propagation here so the menu container can catch it and close
        onClick?.()
      }}
      className={cn(
        'relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        !disabled && 'hover:bg-accent hover:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      {children}
    </div>
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
  return <div role="separator" className={cn('bg-border -mx-1 my-1 h-px', className)} />
}
