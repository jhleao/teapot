import type { LocalRepo } from '@shared/types'
import React from 'react'

export function RepoMetadata({ repo }: { repo: LocalRepo }): React.JSX.Element {
  // Extract folder name from path (e.g., "/Users/name/projects/my-repo" -> "my-repo")
  const folderName = repo.path.split('/').filter(Boolean).pop() || repo.path

  return (
    <div className="flex flex-col">
      <h1 className="text-foreground text-lg leading-tight font-semibold">{folderName}</h1>
      <p className="text-muted-foreground text-xs leading-tight">{repo.path}</p>
    </div>
  )
}
