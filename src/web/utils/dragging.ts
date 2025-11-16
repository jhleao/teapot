import { UiStack } from '@shared/types'
import { RefObject } from 'react'
import { getUiCommitBySha } from './stack-utils'

/**
 * Finds the closest commit below the mouse cursor.
 */
export function findClosestCommitBelowMouse(
  mouseY: number,
  commitRefsMap: Map<string, RefObject<HTMLDivElement>>,
  stacks: UiStack
): string | null {
  let closestSha: string | null = null
  let closestDistance = Infinity

  for (const [sha, ref] of commitRefsMap.entries()) {
    const commit = getUiCommitBySha(stacks, sha)
    if (!commit) continue
    if (commit.rebaseStatus) continue // Skip commits under planning

    const element = ref.current
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const commitCenterY = rect.top + rect.height / 2

    // Only consider commits that are below the mouse
    if (commitCenterY > mouseY) {
      const distance = commitCenterY - mouseY
      if (distance < closestDistance) {
        closestDistance = distance
        closestSha = sha
      }
    }
  }

  return closestSha
}
