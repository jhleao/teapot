import type { LocalRepo } from '@shared/types'
import React from 'react'
import { WorktreeBadge } from './WorktreeBadge'

export function RepoMetadata({ repo }: { repo: LocalRepo }): React.JSX.Element {
  // Extract folder name from path (e.g., "/Users/name/projects/my-repo" -> "my-repo")
  const folderName = repo.path.split('/').filter(Boolean).pop() || repo.path

  // Check if we're in a different worktree than the main repo
  const activeWorktree = repo.activeWorktreePath
  const isInWorktree = activeWorktree != null && activeWorktree !== repo.path

  return (
    <div className="flex flex-col">
      <h1 className="text-foreground text-lg leading-tight font-semibold">{folderName}</h1>
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-xs leading-tight">{repo.path}</p>
        {isInWorktree && activeWorktree && (
          <WorktreeBadge
            data={{ path: activeWorktree, status: 'active', isMain: false }}
            variant="compact"
          />
        )}
      </div>
    </div>
  )
}
