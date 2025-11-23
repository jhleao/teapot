import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'

interface ContextMenuProps {
  children: React.ReactNode
  content: React.ReactNode
  disabled?: boolean
}

export function ContextMenu({ children, content, disabled }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

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
            className={cn(
              'bg-popover text-popover-foreground animate-in fade-in zoom-in-95 fixed z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md',
              'border-border bg-background'
            )}
            style={{ top: position.y, left: position.x }}
            onClick={() => {
              // Close on item click
              close()
            }}
          >
            {content}
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
  disabled
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
}) {
  return (
    <div
      onClick={() => {
        if (disabled) return
        // Don't stop propagation here so the menu container can catch it and close
        onClick?.()
      }}
      className={cn(
        'relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        'hover:bg-accent hover:text-accent-foreground',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {children}
    </div>
  )
}

export function ContextMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('bg-border -mx-1 my-1 h-px', className)} />
}
