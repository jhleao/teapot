import type { LocalRepo } from '@shared/types'
import { ChevronDown } from 'lucide-react'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'
import { ForgeStatusIndicator } from './ForgeStatusIndicator'
import { WorktreeBadge } from './WorktreeBadge'

interface RepoSelectorHeaderProps {
  repo: LocalRepo | null
  repos: LocalRepo[]
  onSelectRepo: (path: string) => Promise<void>
  onAddRepo: () => Promise<void>
  onRemoveRepo: (path: string) => Promise<void>
  onCloneRepo: () => void
}

export function RepoSelectorHeader({
  repo,
  repos,
  onSelectRepo,
  onAddRepo,
  onRemoveRepo,
  onCloneRepo
}: RepoSelectorHeaderProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{ x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Extract folder name from path
  const folderName = repo ? repo.path.split('/').filter(Boolean).pop() || repo.path : null

  // Check if we're in a different worktree than the main repo
  const activeWorktree = repo?.activeWorktreePath
  const isInWorktree = activeWorktree != null && activeWorktree !== repo?.path

  const closeDropdown = useCallback(() => {
    setIsOpen(false)
    setDropdownPosition(null)
  }, [])

  const handleToggle = useCallback(() => {
    if (isOpen) {
      closeDropdown()
    } else {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setDropdownPosition({
          x: rect.left,
          y: rect.bottom + 4
        })
      }
      setIsOpen(true)
    }
  }, [isOpen, closeDropdown])

  const handleSelectRepo = useCallback(
    async (path: string): Promise<void> => {
      await onSelectRepo(path)
      closeDropdown()
    },
    [onSelectRepo, closeDropdown]
  )

  const handleAddRepo = useCallback(async (): Promise<void> => {
    await onAddRepo()
    closeDropdown()
  }, [onAddRepo, closeDropdown])

  const handleCloneRepo = useCallback((): void => {
    onCloneRepo()
    closeDropdown()
  }, [onCloneRepo, closeDropdown])

  const handleRemoveRepo = useCallback(
    async (e: React.MouseEvent, path: string): Promise<void> => {
      e.stopPropagation()
      await onRemoveRepo(path)
    },
    [onRemoveRepo]
  )

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        closeDropdown()
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeDropdown()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, closeDropdown])

  // Empty state when no repo selected
  if (!repo) {
    return <div className="text-muted-foreground text-sm">No repository selected</div>
  }

  return (
    <div className="flex items-center gap-2">
      {/* Clickable repo trigger */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="hover:bg-muted -ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={repo.path}
      >
        <span className="text-foreground text-sm font-medium">{folderName}</span>
        <ChevronDown
          className={cn(
            'text-muted-foreground h-3.5 w-3.5 transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>
      {isInWorktree && activeWorktree && (
        <WorktreeBadge
          data={{ path: activeWorktree, status: 'active', isMain: false }}
          variant="compact"
        />
      )}

      {/* Forge status indicator */}
      <ForgeStatusIndicator />

      {/* Portal dropdown */}
      {isOpen && dropdownPosition && (
        <RepoDropdown
          ref={dropdownRef}
          repos={repos}
          position={dropdownPosition}
          triggerRef={triggerRef}
          onSelectRepo={handleSelectRepo}
          onAddRepo={handleAddRepo}
          onCloneRepo={handleCloneRepo}
          onRemoveRepo={handleRemoveRepo}
        />
      )}
    </div>
  )
}

interface RepoDropdownProps {
  repos: LocalRepo[]
  position: { x: number; y: number }
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onSelectRepo: (path: string) => Promise<void>
  onAddRepo: () => Promise<void>
  onCloneRepo: () => void
  onRemoveRepo: (e: React.MouseEvent, path: string) => Promise<void>
}

const RepoDropdown = React.forwardRef<HTMLDivElement, RepoDropdownProps>(function RepoDropdown(
  { repos, position, triggerRef, onSelectRepo, onAddRepo, onCloneRepo, onRemoveRepo },
  forwardedRef
) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [isPositioned, setIsPositioned] = useState(false)
  const [finalPosition, setFinalPosition] = useState(position)

  // Adjust position before paint, then reveal
  useLayoutEffect(() => {
    const dropdown = innerRef.current
    const trigger = triggerRef.current
    if (!dropdown) return

    const rect = dropdown.getBoundingClientRect()
    const triggerRect = trigger?.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = position.x
    let y = position.y

    // Adjust horizontal position if needed
    if (x + rect.width > viewportWidth - 8) {
      x = viewportWidth - rect.width - 8
    }
    // Ensure doesn't go off left edge
    if (x < 8) {
      x = 8
    }

    // Adjust vertical position if needed (show above if no room below)
    if (y + rect.height > viewportHeight - 8) {
      const triggerHeight = triggerRect?.height ?? 48
      y = position.y - rect.height - triggerHeight - 8
    }

    setFinalPosition({ x, y })
    setIsPositioned(true)
  }, [position, triggerRef])

  // Merge refs
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      ;(innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  return createPortal(
    <div
      ref={setRef}
      role="menu"
      aria-label="Repository selection"
      className={cn(
        'bg-card border-border fixed z-50 w-80 overflow-hidden rounded-lg border shadow-lg',
        isPositioned ? 'animate-in fade-in zoom-in-95' : 'invisible'
      )}
      style={{ top: finalPosition.y, left: finalPosition.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="max-h-96 overflow-y-auto py-1">
        {repos.length === 0 ? (
          <div className="text-muted-foreground px-4 py-3 text-sm">No repositories found</div>
        ) : (
          repos.map((repo) => {
            const repoFolderName = repo.path.split('/').filter(Boolean).pop() || repo.path
            return (
              <button
                key={repo.path}
                onClick={() => onSelectRepo(repo.path)}
                className={cn(
                  'hover:bg-muted flex w-full items-start gap-3 px-4 py-2 text-left transition-colors',
                  repo.isSelected && 'bg-accent/20'
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {repo.isSelected ? (
                    <svg
                      className="text-accent-foreground h-4 w-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="text-muted-foreground h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-sm font-medium',
                      repo.isSelected ? 'text-accent-foreground' : 'text-foreground'
                    )}
                  >
                    {repoFolderName}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">{repo.path}</div>
                </div>
                <button
                  onClick={(e) => onRemoveRepo(e, repo.path)}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded p-1 transition-colors"
                  aria-label="Remove repository"
                  title="Remove repository"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </button>
            )
          })
        )}
      </div>
      <div className="border-border border-t">
        <button
          onClick={() => onAddRepo()}
          className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
        >
          <svg
            className="text-muted-foreground h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Repository</span>
        </button>
        <button
          onClick={onCloneRepo}
          className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
        >
          <svg
            className="text-muted-foreground h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Clone Repository</span>
        </button>
      </div>
    </div>,
    document.body
  )
})
