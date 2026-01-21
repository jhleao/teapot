import { UiStack } from '@shared/types'
import { RefObject } from 'react'
import { getUiCommitBySha } from './stack-utils'

export interface CommitBoundingBox {
  sha: string
  centerY: number
}

export interface CapturedDragState {
  boundingBoxes: CommitBoundingBox[]
  initialScrollTop: number
}

/**
 * Captures the initial bounding boxes of all commits and scroll position at drag start.
 * These positions are frozen and used throughout the drag operation to prevent
 * flickering when the optimistic UI updates.
 */
export function captureCommitBoundingBoxes(
  commitRefsMap: Map<string, RefObject<HTMLDivElement>>,
  stacks: UiStack,
  scrollViewport: HTMLElement | null
): CapturedDragState {
  const boundingBoxes: CommitBoundingBox[] = []
  const initialScrollTop = scrollViewport?.scrollTop ?? 0

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

  return { boundingBoxes, initialScrollTop }
}

/**
 * Finds the closest commit below the mouse cursor using pre-captured bounding boxes.
 * Compensates for scroll changes since drag start.
 * This prevents flickering by using stable positions throughout the drag operation.
 */
export function findClosestCommitBelowMouse(
  mouseY: number,
  boundingBoxes: CommitBoundingBox[],
  initialScrollTop: number,
  currentScrollTop: number
): string | null {
  // Calculate scroll delta: how much has been scrolled since drag start
  const scrollDelta = currentScrollTop - initialScrollTop

  // Adjust mouseY to account for scroll change
  // When user scrolls down, elements move up in viewport, so we add scrollDelta
  const adjustedMouseY = mouseY + scrollDelta

  let closestSha: string | null = null
  let closestDistance = Infinity

  for (const box of boundingBoxes) {
    // Only consider commits that are below the mouse
    if (box.centerY > adjustedMouseY) {
      const distance = box.centerY - adjustedMouseY
      if (distance < closestDistance) {
        closestDistance = distance
        closestSha = box.sha
      }
    }
  }

  return closestSha
}
