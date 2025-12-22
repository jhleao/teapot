import { AlertTriangle, FolderOpen, Loader2, LucideIcon, Plus } from 'lucide-react'
import React from 'react'
import { cn } from '../utils/cn'

type EmptyStateVariant = 'no-repo' | 'error' | 'loading'

interface EmptyStateProps {
  variant: EmptyStateVariant
  errorMessage?: string
  onAction?: () => void
}

const config: Record<
  EmptyStateVariant,
  {
    icon: LucideIcon
    spin?: boolean
    iconClassName?: string
    title?: string
    description?: string
    actionLabel?: string
  }
> = {
  'no-repo': {
    icon: FolderOpen,
    title: 'No Repository Selected',
    description: 'Select a repository to get started with your Git workflow',
    actionLabel: 'Select Repository'
  },
  error: {
    icon: AlertTriangle,
    title: 'Failed to load repository'
  },
  loading: {
    icon: Loader2,
    spin: true,
    iconClassName: 'h-6 w-6',
    description: 'Loading...'
  }
}

export function EmptyState({
  variant,
  errorMessage,
  onAction
}: EmptyStateProps): React.JSX.Element {
  const { icon: Icon, spin, iconClassName, title, description, actionLabel } = config[variant]

  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="text-center">
        <Icon
          className={cn(
            'text-muted-foreground mx-auto mb-4',
            iconClassName ?? 'h-16 w-16',
            spin && 'animate-spin'
          )}
          strokeWidth={1.5}
        />
        {title && <h2 className="text-foreground mb-2 text-xl font-semibold">{title}</h2>}
        {(description || errorMessage) && (
          <p className="text-muted-foreground mx-auto mb-6 max-w-md text-sm">
            {errorMessage || description}
          </p>
        )}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="bg-accent text-accent-foreground hover:bg-accent/90 focus:ring-accent inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            {variant === 'no-repo' && <Plus className="h-4 w-4" />}
            <span>{actionLabel}</span>
          </button>
        )}
        {variant === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="bg-accent text-accent-foreground hover:bg-accent/90 focus:ring-accent inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            <span>Reload</span>
          </button>
        )}
      </div>
    </div>
  )
}
