/**
 * ShipItNavigator - Pure domain logic for post-merge navigation.
 *
 * Determines where to navigate after a PR is merged ("shipped").
 * The goal is to provide a smooth UX by:
 * 1. Moving user off the now-merged branch
 * 2. Landing on the most logical next branch (parent or main)
 * 3. Informing user if rebasing is needed for remaining stack
 */

import type { ShipItNavigationContext, ShipItNavigationResult } from '@shared/types'
import { isTrunk } from '@shared/types/repo'

export class ShipItNavigator {
  private constructor() {}

  /**
   * Determines the navigation action after shipping a branch.
   *
   * Decision tree:
   * 1. If user is NOT on shipped branch -> stay where they are
   * 2. If user is on shipped branch:
   *    a. Navigate to PR target (parent branch or main)
   *    b. Indicate if children need rebasing
   *
   * @param context - All the information needed to make the decision
   * @returns Navigation result with action, target branch, and rebase info
   */
  public static determineNavigation(context: ShipItNavigationContext): ShipItNavigationResult {
    const { shippedBranch, prTargetBranch, userCurrentBranch, wasDetached, hasChildren } = context

    // If user was detached or explicitly on the shipped branch, we should navigate
    const wasOnShippedBranch = wasDetached || userCurrentBranch === shippedBranch

    if (!wasOnShippedBranch && userCurrentBranch !== null) {
      // User is on a different branch - stay there
      return {
        action: 'stayed',
        message: hasChildren
          ? `Shipped ${shippedBranch}. Child branches need to be rebased.`
          : `Shipped ${shippedBranch}.`,
        needsRebase: hasChildren
      }
    }

    // User was on the shipped branch (or detached) - navigate to target
    const isTargetTrunk = isTrunk(prTargetBranch)

    if (isTargetTrunk) {
      return {
        action: 'switched-to-main',
        targetBranch: prTargetBranch,
        message: hasChildren
          ? `Shipped ${shippedBranch}. Switched to ${prTargetBranch}. Child branches need to be rebased.`
          : `Shipped ${shippedBranch}. Switched to ${prTargetBranch}.`,
        needsRebase: hasChildren
      }
    } else {
      // PR targeted a parent branch (stacked PR workflow)
      return {
        action: 'switched-to-parent',
        targetBranch: prTargetBranch,
        message: hasChildren
          ? `Shipped ${shippedBranch}. Switched to ${prTargetBranch}. Child branches need to be rebased.`
          : `Shipped ${shippedBranch}. Switched to ${prTargetBranch}.`,
        needsRebase: hasChildren
      }
    }
  }

  /**
   * Determines if a branch has children in the stack.
   *
   * This is used to warn users about rebasing after shipping.
   * A branch has children if other branches have PRs targeting it.
   *
   * @param branchName - The shipped branch name
   * @param pullRequests - All known PRs
   * @returns True if the branch has children
   */
  public static hasChildBranches(
    branchName: string,
    pullRequests: Array<{ baseRefName: string; headRefName: string; state: string }>
  ): boolean {
    // A branch has children if any open PR targets it
    return pullRequests.some((pr) => pr.baseRefName === branchName && pr.state === 'open')
  }

  /**
   * Finds the parent branch of a given branch in a stack.
   *
   * In a stacked PR workflow:
   * main <- feature-1 <- feature-2 <- feature-3
   *
   * The parent of feature-2 is feature-1 (the PR target).
   *
   * @param branchName - The branch to find the parent of
   * @param pullRequests - All known PRs
   * @returns The parent branch name, or null if not found/is trunk
   */
  public static findParentBranch(
    branchName: string,
    pullRequests: Array<{ baseRefName: string; headRefName: string; state: string }>
  ): string | null {
    // Find the open PR for this branch
    const pr = pullRequests.find(
      (p) => p.headRefName === branchName && (p.state === 'open' || p.state === 'draft')
    )

    if (!pr) {
      return null
    }

    // If PR targets trunk, there's no stack parent
    if (isTrunk(pr.baseRefName)) {
      return null
    }

    return pr.baseRefName
  }
}
