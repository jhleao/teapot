import React from 'react'
import { cn } from '../utils/cn'
import type { UiWorkingTreeFile } from '@shared/types'
import { Square, Check } from 'lucide-react'
import { CommitDot } from './SvgPaths'

const STATUS_LETTER_MAP: Record<UiWorkingTreeFile['status'], string> = {
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U'
}

const STATUS_COLOR_MAP: Record<UiWorkingTreeFile['status'], string> = {
  modified: 'text-yellow-600',
  deleted: 'text-red-600',
  renamed: 'text-blue-600',
  untracked: 'text-gray-600'
}

export function WorkingTreeView({
  files,
  className
}: {
  files: UiWorkingTreeFile[]
  className?: string
}): React.JSX.Element {
  // Sort files alphabetically by path
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))

  return (
    <div className={cn('bg-muted/50 rounded-lg w-full flex items-stretch', className)}>
      <div className="flex flex-col h-auto w-[26px] items-center">
        <CommitDot bottom variant="accent" accentLines="bottom" />
        <div className="w-[2px] bg-accent flex-1" />
      </div>
      <div className="flex flex-col py-3 pr-3">
        <div className="text-xs font-semibold mb-2 text-muted-foreground">Working Tree</div>
        {sortedFiles.map((file, index) => (
          <div key={`${file.path}-${index}`} className="flex items-center gap-2 text-xs font-mono">
            {file.isStaged ? (
              <div className="relative">
                <Square className="w-5 h-5 text-green-600 fill-green-600" />
                <Check
                  className="w-3.5 h-3.5 text-white absolute top-[2px] left-[2px]"
                  strokeWidth={3}
                />
              </div>
            ) : (
              <Square className="w-5 h-5 text-muted-foreground" />
            )}
            <span className="flex-1">{file.path}</span>
            <span className={cn('font-semibold', STATUS_COLOR_MAP[file.status])}>
              {STATUS_LETTER_MAP[file.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
