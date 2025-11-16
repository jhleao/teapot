import type { Repo, UiWorkingTreeFile } from '@shared/types'

export function buildUiWorkingTree(repo: Repo): UiWorkingTreeFile[] {
  const { workingTreeStatus } = repo
  const fileMap = new Map<string, { isStaged: boolean; status: UiWorkingTreeFile['status'] }>()

  // Process staged files first (they can also appear in other arrays)
  for (const path of workingTreeStatus.staged) {
    fileMap.set(path, { isStaged: true, status: 'modified' })
  }

  // Process deleted files (can override staged status for status, but keep isStaged if already set)
  for (const path of workingTreeStatus.deleted) {
    const existing = fileMap.get(path)
    fileMap.set(path, {
      isStaged: existing?.isStaged ?? false,
      status: 'deleted'
    })
  }

  // Process renamed files
  for (const path of workingTreeStatus.renamed) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { isStaged: false, status: 'renamed' })
    } else {
      // Keep isStaged from existing, but update status to renamed
      fileMap.set(path, { isStaged: existing.isStaged, status: 'renamed' })
    }
  }

  // Process modified files (unstaged modifications)
  for (const path of workingTreeStatus.modified) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { isStaged: false, status: 'modified' })
    }
    // If already exists (e.g., from staged), keep existing status
  }

  // Process created files (new tracked files)
  for (const path of workingTreeStatus.created) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { isStaged: false, status: 'untracked' })
    }
  }

  // Process untracked files
  for (const path of workingTreeStatus.not_added) {
    const existing = fileMap.get(path)
    if (!existing) {
      fileMap.set(path, { isStaged: false, status: 'untracked' })
    }
  }

  // Convert map to array of UiWorkingTreeFile and sort by path for deterministic order
  return Array.from(fileMap.entries())
    .map(([path, { isStaged, status }]) => ({
      path,
      isStaged,
      status
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
