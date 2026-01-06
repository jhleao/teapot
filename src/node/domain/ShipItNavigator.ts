/**
 * ShipItNavigator - Pure domain logic for Ship It operations.
 *
 * Contains:
 * 1. Pre-merge validation (can this PR be shipped?)
 * 2. Post-merge navigation (where should user go after shipping?)
 *
 * All functions are pure and deterministic - no I/O.
 */

import type { ShipItNavigationContext, ShipItNavigationResult } from '@shared/types'
import { isTrunk } from '@shared/types/repo'

/** Minimal PR shape for validation functions */
type PrForValidation = {
  headRefName: string
  baseRefName: string
  state: string
  isMergeable: boolean
}

/** Result of Ship It validation */
export type ShipItValidationResult = { canShip: true } | { canShip: false; reason: string }

export class ShipItNavigator {
  private constructor() {}

  // ============================================================================
  // Pre-merge Validation (Pure Logic)
  // ============================================================================

  /**
   * Validates whether a PR can be shipped.
   * Returns an error reason if shipping should be blocked.
   *
   * Checks:
   * 1. PR exists and is open
   * 2. PR is mergeable (no conflicts, checks pass)
   * 3. Target branch hasn't been merged (stale target)
   * 4. Branch has no child PRs (must ship children first)
   */
  public static validateCanShip(
    branchName: string,
    pullRequests: PrForValidation[]
  ): ShipItValidationResult {
    // Find the PR for this branch
    const pr = pullRequests.find((p) => p.headRefName === branchName && p.state === 'open')

    if (!pr) {
      return { canShip: false, reason: `No open PR found for branch "${branchName}"` }
    }

    // Check if PR is mergeable
    if (!pr.isMergeable) {
      return {
        canShip: false,
        reason: 'PR is not mergeable. Check for conflicts or failing checks.'
      }
    }

    // Check if target branch has been merged (stale target)
    const targetBranch = pr.baseRefName
    if (!isTrunk(targetBranch)) {
      const targetBranchMerged = pullRequests.some(
        (p) => p.headRefName === targetBranch && p.state === 'merged'
      )
      if (targetBranchMerged) {
        return {
          canShip: false,
          reason: `Target branch "${targetBranch}" has been merged. Update the PR target first.`
        }
      }
    }

    // Check if this branch has children (other PRs targeting it)
    if (ShipItNavigator.hasChildBranches(branchName, pullRequests)) {
      return {
        canShip: false,
        reason: 'Cannot ship a branch that has child PRs. Ship the child branches first.'
      }
    }

    return { canShip: true }
  }

  // ============================================================================
  // Post-merge Navigation (Pure Logic)
  // ============================================================================

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
