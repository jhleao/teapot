import type { UiWorkingTreeFile } from '@shared/types'
import { SquareDot, SquarePlus, SquareX } from 'lucide-react'
import React from 'react'
import { cn } from '../utils/cn'
import { Checkbox } from './Checkbox'

const STATUS_ICON_MAP: Record<
  UiWorkingTreeFile['status'],
  React.ComponentType<{ className?: string }>
> = {
  modified: SquareDot,
  deleted: SquareX,
  renamed: SquareDot,
  untracked: SquarePlus
}

const STATUS_COLOR_MAP: Record<UiWorkingTreeFile['status'], string> = {
  modified: 'text-warning',
  deleted: 'text-error',
  renamed: 'text-warning',
  untracked: 'text-success'
}

function FileStatusBadge({ status }: { status: UiWorkingTreeFile['status'] }) {
  const Icon = STATUS_ICON_MAP[status]
  return <Icon className={cn('h-4 w-4', STATUS_COLOR_MAP[status])} />
}

export function FileItem({
  file,
  onToggle
}: {
  file: UiWorkingTreeFile
  onToggle: (file: UiWorkingTreeFile) => void
}) {
  const lastSlashIndex = file.path.lastIndexOf('/')
  const directoryPath = lastSlashIndex >= 0 ? file.path.slice(0, lastSlashIndex + 1) : ''
  const filename = lastSlashIndex >= 0 ? file.path.slice(lastSlashIndex + 1) : file.path

  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox state={file.isStaged ? 'checked' : 'unchecked'} onClick={() => onToggle(file)} />
      <div className="ml-4 flex items-center gap-2">
        <FileStatusBadge status={file.status} />
        <span className="flex-1">
          {directoryPath && <span className="text-muted-foreground">{directoryPath}</span>}
          <span className="text-foreground">{filename}</span>
        </span>
      </div>
    </div>
  )
}
