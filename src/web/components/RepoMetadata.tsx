import type { LocalRepo } from '@shared/types'
import React from 'react'
import { TreeIcon } from './icons'

export function RepoMetadata({ repo }: { repo: LocalRepo }): React.JSX.Element {
  // Extract folder name from path (e.g., "/Users/name/projects/my-repo" -> "my-repo")
  const folderName = repo.path.split('/').filter(Boolean).pop() || repo.path

  // Check if we're in a different worktree than the main repo
  const activeWorktree = repo.activeWorktreePath
  const isInWorktree = activeWorktree != null && activeWorktree !== repo.path

  // Get just the directory name from the worktree path
  const worktreeDirName = activeWorktree?.split('/').pop() || activeWorktree

  return (
    <div className="flex flex-col">
      <h1 className="text-foreground text-lg leading-tight font-semibold">{folderName}</h1>
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-xs leading-tight">{repo.path}</p>
        {isInWorktree && (
          <span
            className="bg-muted/50 text-muted-foreground/70 border-border/50 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
            title={activeWorktree}
          >
            Using worktree
            <TreeIcon className="h-3.5 w-3.5" />
            {worktreeDirName}
          </span>
        )}
      </div>
    </div>
  )
}
