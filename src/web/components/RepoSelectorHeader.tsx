import type { LocalRepo } from '@shared/types'
import { CheckCircle2, ChevronDown, Download, Folder, Plus, X } from 'lucide-react'
import React, { useState } from 'react'
import { cn } from '../utils/cn'
import { ForgeStatusIndicator } from './ForgeStatusIndicator'
import { Tooltip } from './Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
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

  const folderName = repo ? repo.path.split('/').filter(Boolean).pop() || repo.path : null
  const activeWorktree = repo?.activeWorktreePath
  const isInWorktree = activeWorktree != null && activeWorktree !== repo?.path

  async function handleSelectRepo(path: string): Promise<void> {
    await onSelectRepo(path)
    setIsOpen(false)
  }

  async function handleAddRepo(): Promise<void> {
    await onAddRepo()
    setIsOpen(false)
  }

  function handleCloneRepo(): void {
    onCloneRepo()
    setIsOpen(false)
  }

  async function handleRemoveRepo(e: React.MouseEvent, path: string): Promise<void> {
    e.stopPropagation()
    await onRemoveRepo(path)
  }

  if (!repo) {
    return (
      <div className="flex items-center gap-2" data-testid="topbar">
        <div data-testid="repo-selector">
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button
                className="hover:bg-muted -ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
                data-testid="repo-selector-button"
              >
                <span className="text-muted-foreground text-sm" data-testid="no-repo-message">
                  No repository selected
                </span>
                <ChevronDown
                  className={cn(
                    'text-muted-foreground h-3.5 w-3.5 transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 overflow-hidden p-0"
              onMouseDown={(e) => e.stopPropagation()}
              data-testid="repo-dropdown"
            >
              <div className="max-h-96 overflow-y-auto py-1">
                <div className="text-muted-foreground px-4 py-3 text-sm">No repositories found</div>
              </div>
              <div className="border-border border-t">
                <button
                  onClick={handleAddRepo}
                  className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
                  data-testid="add-repo-button"
                >
                  <Plus className="text-muted-foreground h-4 w-4" />
                  <span>Add Repository</span>
                </button>
                <button
                  onClick={handleCloneRepo}
                  className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
                  data-testid="clone-repo-button"
                >
                  <Download className="text-muted-foreground h-4 w-4" />
                  <span>Clone Repository</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <ForgeStatusIndicator />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2" data-testid="topbar">
      <div data-testid="repo-selector">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip content={repo.path} side="bottom">
            <PopoverTrigger asChild>
              <button
                className="hover:bg-muted -ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
                data-testid="repo-selector-button"
              >
                <span
                  className="text-foreground text-sm font-medium"
                  data-testid="repo-metadata-container"
                >
                  {folderName}
                </span>
                <ChevronDown
                  className={cn(
                    'text-muted-foreground h-3.5 w-3.5 transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent
            align="start"
            className="w-80 overflow-hidden p-0"
            onMouseDown={(e) => e.stopPropagation()}
            data-testid="repo-dropdown"
          >
            <div className="max-h-96 overflow-y-auto py-1">
              {repos.length === 0 ? (
                <div className="text-muted-foreground px-4 py-3 text-sm">No repositories found</div>
              ) : (
                repos.map((r) => (
                  <RepoItem
                    key={r.path}
                    repo={r}
                    onSelect={handleSelectRepo}
                    onRemove={handleRemoveRepo}
                  />
                ))
              )}
            </div>
            <div className="border-border border-t">
              <button
                onClick={handleAddRepo}
                className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
                data-testid="add-repo-button"
              >
                <Plus className="text-muted-foreground h-4 w-4" />
                <span>Add Repository</span>
              </button>
              <button
                onClick={handleCloneRepo}
                className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
                data-testid="clone-repo-button"
              >
                <Download className="text-muted-foreground h-4 w-4" />
                <span>Clone Repository</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {isInWorktree && activeWorktree && (
        <WorktreeBadge
          data={{ path: activeWorktree, status: 'active', isMain: false }}
          variant="compact"
        />
      )}

      <ForgeStatusIndicator />
    </div>
  )
}

interface RepoItemProps {
  repo: LocalRepo
  onSelect: (path: string) => Promise<void>
  onRemove: (e: React.MouseEvent, path: string) => Promise<void>
}

function RepoItem({ repo, onSelect, onRemove }: RepoItemProps): React.JSX.Element {
  const folderName = repo.path.split('/').filter(Boolean).pop() || repo.path

  return (
    <button
      onClick={() => onSelect(repo.path)}
      className={cn(
        'hover:bg-muted flex w-full items-start gap-3 px-4 py-2 text-left transition-colors',
        repo.isSelected && 'bg-accent/20'
      )}
    >
      <div className="mt-0.5 shrink-0">
        {repo.isSelected ? (
          <CheckCircle2 className="text-accent-foreground h-4 w-4" />
        ) : (
          <Folder className="text-muted-foreground h-4 w-4" />
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
        onClick={(e) => onRemove(e, repo.path)}
        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded p-1 transition-colors"
        aria-label="Remove repository"
        title="Remove repository"
      >
        <X className="h-4 w-4" />
      </button>
    </button>
  )
}
