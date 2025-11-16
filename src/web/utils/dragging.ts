import { UiStack } from '@shared/types'
import { RefObject } from 'react'
import { getUiCommitBySha } from './stack-utils'

export interface CommitBoundingBox {
  sha: string
  centerY: number
}

/**
 * Captures the initial bounding boxes of all commits at drag start.
 * These positions are frozen and used throughout the drag operation to prevent
 * flickering when the optimistic UI updates.
 */
export function captureCommitBoundingBoxes(
  commitRefsMap: Map<string, RefObject<HTMLDivElement>>,
  stacks: UiStack
): CommitBoundingBox[] {
  const boundingBoxes: CommitBoundingBox[] = []

  for (const [sha, ref] of commitRefsMap.entries()) {
    const commit = getUiCommitBySha(stacks, sha)
    if (!commit) continue
    if (commit.rebaseStatus) continue // Skip commits under planning

    const element = ref.current
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const commitCenterY = rect.top + rect.height / 2

    boundingBoxes.push({ sha, centerY: commitCenterY })
  }

  return boundingBoxes
}

/**
 * Finds the closest commit below the mouse cursor using pre-captured bounding boxes.
 * This prevents flickering by using stable positions throughout the drag operation.
 */
export function findClosestCommitBelowMouse(
  mouseY: number,
  boundingBoxes: CommitBoundingBox[]
): string | null {
  let closestSha: string | null = null
  let closestDistance = Infinity

  for (const box of boundingBoxes) {
    // Only consider commits that are below the mouse
    if (box.centerY > mouseY) {
      const distance = box.centerY - mouseY
      if (distance < closestDistance) {
        closestDistance = distance
        closestSha = box.sha
      }
    }
  }

  return closestSha
}
