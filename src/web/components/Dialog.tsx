import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'

interface DialogProps {
  children: React.ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function Dialog({ children, open, onOpenChange }: DialogProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    if (open) document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <DialogPortal>
      <DialogOverlay onClick={() => onOpenChange(false)} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
        {/* Content wrapper to center */}
        <div className="pointer-events-auto">{children}</div>
      </div>
    </DialogPortal>
  )
}

function DialogPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

function DialogOverlay({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="animate-in fade-in fixed inset-0 z-50 bg-black/10 backdrop-blur-sm duration-200"
    />
  )
}

export function DialogContent({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-background text-foreground border-border animate-in fade-in slide-in-from-top-2 fixed top-[50%] left-[50%]',
        'z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%]',
        'gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg',
        className
      )}
    >
      {children}
    </div>
  )
}

export function DialogHeader({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}>
      {children}
    </div>
  )
}

export function DialogFooter({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}>
      {children}
    </div>
  )
}

export function DialogTitle({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <h2 className={cn('text-lg leading-none font-semibold tracking-tight', className)}>
      {children}
    </h2>
  )
}

export function DialogDescription({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return <p className={cn('text-muted-foreground text-sm', className)}>{children}</p>
}
