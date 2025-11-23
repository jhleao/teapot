import type { LocalRepo } from '@shared/types'
import React, { useEffect, useRef, useState } from 'react'
import { cn } from '../utils/cn'

export function RepoSelector({
  repos,
  onSelectRepo,
  onAddRepo,
  onRemoveRepo
}: {
  repos: LocalRepo[]
  onSelectRepo: (path: string) => Promise<void>
  onAddRepo: () => Promise<void>
  onRemoveRepo: (path: string) => Promise<void>
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
    return undefined
  }, [isOpen])

  const selectedRepo = repos.find((repo) => repo.isSelected)
  const selectedFolderName = selectedRepo
    ? selectedRepo.path.split('/').filter(Boolean).pop() || selectedRepo.path
    : 'Select Repository'

  const handleSelectRepo = async (path: string): Promise<void> => {
    await onSelectRepo(path)
    setIsOpen(false)
  }

  const handleAddRepo = async (): Promise<void> => {
    await onAddRepo()
    setIsOpen(false)
  }

  const handleRemoveRepo = async (e: React.MouseEvent, path: string): Promise<void> => {
    e.stopPropagation() // Prevent triggering the select action
    await onRemoveRepo(path)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-foreground bg-card border-border hover:bg-muted focus:ring-accent inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-haspopup="true"
        aria-expanded={isOpen}
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
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span>{selectedFolderName}</span>
        <svg
          className={cn(
            'text-muted-foreground h-4 w-4 transition-transform',
            isOpen && 'rotate-180'
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="bg-card border-border absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border shadow-lg">
          <div className="max-h-96 overflow-y-auto py-1">
            {repos.length === 0 ? (
              <div className="text-muted-foreground px-4 py-3 text-sm">No repositories found</div>
            ) : (
              repos.map((repo) => {
                const folderName = repo.path.split('/').filter(Boolean).pop() || repo.path
                return (
                  <button
                    key={repo.path}
                    onClick={() => handleSelectRepo(repo.path)}
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
                        {folderName}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">{repo.path}</div>
                    </div>
                    <button
                      onClick={(e) => handleRemoveRepo(e, repo.path)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded p-1 transition-colors"
                      aria-label="Remove repository"
                      title="Remove repository"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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
              onClick={() => handleAddRepo()}
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add Repository</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
