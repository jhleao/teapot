import type { Repo, UiWorkingTreeFile } from '@shared/types'

export function buildUiWorkingTree(repo: Repo): UiWorkingTreeFile[] {
  const { workingTreeStatus } = repo
  const fileMap = new Map<
    string,
    { stageStatus: UiWorkingTreeFile['stageStatus']; status: UiWorkingTreeFile['status'] }
  >()

  for (const path of workingTreeStatus.staged) {
    fileMap.set(path, { stageStatus: 'staged', status: 'modified' })
  }

  for (const path of workingTreeStatus.deleted) {
    const existing = fileMap.get(path)
    fileMap.set(path, {
      stageStatus: existing?.stageStatus ?? 'unstaged',
      status: 'deleted'
    })
  }

  for (const path of workingTreeStatus.renamed) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { stageStatus: 'unstaged', status: 'renamed' })
    } else {
      fileMap.set(path, { stageStatus: existing.stageStatus, status: 'renamed' })
    }
  }

  for (const path of workingTreeStatus.modified) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { stageStatus: 'unstaged', status: 'modified' })
    } else if (existing.stageStatus === 'staged') {
      fileMap.set(path, { ...existing, stageStatus: 'partially-staged' })
    }
  }

  for (const path of workingTreeStatus.created) {
    const existing = fileMap.get(path)
    // The 'staged' list contains all files with index changes, initializing them as 'modified'.
    // 'created' specifically identifies new files (status 'A').
    // If the file is already in the map (from the staged loop), we refine its status to 'added'.
    if (existing) {
      // If it was marked as 'partially-staged', we keep that stage status, but refine status to 'added'.
      fileMap.set(path, { stageStatus: existing.stageStatus, status: 'added' })
    } else {
      // Fallback: If the file wasn't captured in the 'staged' list for some reason,
      // we still mark it as 'added' since it appears in 'created'.
      fileMap.set(path, { stageStatus: 'unstaged', status: 'added' })
    }
  }

  for (const path of workingTreeStatus.not_added) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { stageStatus: 'unstaged', status: 'added' })
    }
  }

  // Handle conflicted files - these take priority over other statuses
  for (const path of workingTreeStatus.conflicted) {
    fileMap.set(path, { stageStatus: 'unstaged', status: 'conflicted' })
  }

  return Array.from(fileMap.entries())
    .map(([path, { stageStatus, status }]) => ({
      path,
      stageStatus,
      status
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
