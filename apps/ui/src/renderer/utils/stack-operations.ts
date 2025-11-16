import type { UiStack, UiCommit } from '@teapot/contract'

/**
 * Clone a single commit including its branches and spinoffs
 */
function cloneCommit(commit: UiCommit): UiCommit {
  return {
    ...commit,
    branches: [...commit.branches],
    spinoffs: commit.spinoffs.map(cloneStack)
  }
}

/**
 * Deep clone a stack structure including all nested commits and spinoffs
 */
function cloneStack(stack: UiStack): UiStack {
  return {
    commits: stack.commits.map(cloneCommit),
    isTrunk: stack.isTrunk
  }
}

/**
 * Check if a candidate commit is inside the dragging stack.
 * The dragging stack includes:
 * - The dragging commit itself
 * - All commits that come after the dragging commit in the same stack (direct children)
 * - All commits in spinoffs (recursively) of the dragging commit and its children
 *
 * @param stack The root stack to search in
 * @param draggingSha The SHA of the commit being dragged
 * @param candidateSha The SHA of the commit to check
 * @returns true if candidateSha is inside the dragging stack
 */
export function isInsideDraggingStack(
  stack: UiStack,
  draggingSha: string,
  candidateSha: string
): boolean {
  // If it's the dragging commit itself, it's inside
  if (candidateSha === draggingSha) {
    return true
  }

  // Find the dragging commit
  const draggingInfo = findCommitInfo(stack, draggingSha)
  if (!draggingInfo) {
    return false
  }

  const { parentStack: draggingParentStack, index: draggingIndex } = draggingInfo

  // Check if candidate is in the same stack and comes after dragging commit
  const candidateInfo = findCommitInfo(stack, candidateSha)
  if (!candidateInfo) {
    return false
  }

  const { parentStack: candidateParentStack, index: candidateIndex } = candidateInfo

  // If they're in the same stack and candidate comes after dragging commit
  if (draggingParentStack === candidateParentStack && candidateIndex > draggingIndex) {
    return true
  }

  // Check if candidate is in any spinoff of the dragging commit or its children
  // All commits from draggingIndex onwards are part of the dragging stack
  for (let i = draggingIndex; i < draggingParentStack.commits.length; i++) {
    const commit = draggingParentStack.commits[i]
    if (isInSpinoffs(commit.spinoffs, candidateSha)) {
      return true
    }
  }

  return false
}

/**
 * Helper function to check if a commit exists in any spinoff stack (recursively)
 */
function isInSpinoffs(spinoffs: UiStack[], sha: string): boolean {
  for (const spinoff of spinoffs) {
    // Check direct commits in this spinoff
    if (spinoff.commits.some((c) => c.sha === sha)) {
      return true
    }

    // Recursively check nested spinoffs
    for (const commit of spinoff.commits) {
      if (isInSpinoffs(commit.spinoffs, sha)) {
        return true
      }
    }
  }

  return false
}

/**
 * Find a commit by SHA and return detailed information about its location
 * @returns Object containing the commit, its parent stack, and index, or null if not found
 */
function findCommitInfo(
  stack: UiStack,
  sha: string
): { commit: UiCommit; parentStack: UiStack; index: number } | null {
  const index = stack.commits.findIndex((c) => c.sha === sha)
  if (index !== -1) {
    return { commit: stack.commits[index], parentStack: stack, index }
  }

  // Recursively search spinoffs
  for (const commit of stack.commits) {
    for (const spinoff of commit.spinoffs) {
      const found = findCommitInfo(spinoff, sha)
      if (found) return found
    }
  }

  return null
}

/**
 * Extract the dragging stack from a stack. The dragging stack includes:
 * - The dragging commit itself
 * - All commits that come after it in the array (children)
 * - All their spinoffs (which are cloned)
 *
 * Mutates the source stack by removing extracted commits.
 *
 * @param stack The stack to extract from (will be mutated)
 * @param draggingSha The SHA of the dragging commit to start extraction from
 * @returns The extracted dragging stack, or null if commit not found
 */
function extractDraggingStack(stack: UiStack, draggingSha: string): UiStack | null {
  const commitInfo = findCommitInfo(stack, draggingSha)
  if (!commitInfo) return null

  const { parentStack, index } = commitInfo

  // Extract the dragging commit and all commits after it (children)
  // Array is ordered: parent first (lower index), child last (higher index)
  const commitsToExtract = parentStack.commits.slice(index)

  // Create a new stack with the extracted dragging stack (with cloned commits)
  const draggingStack: UiStack = {
    commits: commitsToExtract.map(cloneCommit),
    isTrunk: false
  }

  // Remove extracted commits from the parent stack
  const extractedShas = new Set(commitsToExtract.map((c) => c.sha))
  parentStack.commits = parentStack.commits.filter((c) => !extractedShas.has(c.sha))

  return draggingStack
}

/**
 * Check if a commit is the head (last commit) of its stack
 * @param stack The stack to search in
 * @param sha The SHA of the commit to check
 * @returns true if the commit is the head of its stack
 */
function isHeadOfStack(stack: UiStack, sha: string): boolean {
  const commitInfo = findCommitInfo(stack, sha)
  if (!commitInfo) return false

  const { parentStack, index } = commitInfo

  // The head is the last commit in the array (highest index)
  return index === parentStack.commits.length - 1
}

/**
 * Add a stack as a spinoff to a target commit
 * @param rootStack The root stack to search in (will be mutated)
 * @param targetCommitSha The SHA of the commit to add the spinoff to
 * @param stackToAdd The stack to add as a spinoff
 */
function addStackAsSpinoff(rootStack: UiStack, targetCommitSha: string, stackToAdd: UiStack): void {
  const commitInfo = findCommitInfo(rootStack, targetCommitSha)
  if (!commitInfo) return

  const { commit } = commitInfo
  commit.spinoffs.push(stackToAdd)
}

/**
 * Append commits from a stack to the end of the target commit's parent stack
 * @param rootStack The root stack to search in (will be mutated)
 * @param targetCommitSha The SHA of the commit whose parent stack to append to
 * @param stackToAppend The stack whose commits to append
 */
function appendToStack(rootStack: UiStack, targetCommitSha: string, stackToAppend: UiStack): void {
  const commitInfo = findCommitInfo(rootStack, targetCommitSha)
  if (!commitInfo) return

  const { parentStack } = commitInfo
  parentStack.commits.push(...stackToAppend.commits)
}

/**
 * Remove empty spinoffs from commits recursively
 * @param stack The stack to clean up (will be mutated)
 */
function removeEmptySpinoffs(stack: UiStack): void {
  for (const commit of stack.commits) {
    // First, recursively clean up nested spinoffs
    commit.spinoffs.forEach(removeEmptySpinoffs)

    // Then remove spinoffs with no commits
    commit.spinoffs = commit.spinoffs.filter((spinoff) => spinoff.commits.length > 0)
  }
}

/**
 * Build an optimistic drag state when dragging a commit above another commit
 * @param stack The current base stack
 * @param draggingSha The SHA of the commit being dragged
 * @param overSha The SHA of the commit to place the dragged commit above (the target)
 * @returns A new stack with the dragging operation applied, or null if operation fails
 */
export function buildOptimisticDrag(
  stack: UiStack,
  draggingSha: string,
  overSha: string
): UiStack | null {
  try {
    // Clone the stack to avoid mutating the original
    const clonedStack = cloneStack(stack)

    // Extract the dragging stack (dragging commit + its children + their spinoffs)
    const draggingStack = extractDraggingStack(clonedStack, draggingSha)
    if (!draggingStack) {
      console.error(`Could not find dragging commit: ${draggingSha}`)
      return null
    }

    // Clean up any empty spinoffs that may have resulted from extraction
    removeEmptySpinoffs(clonedStack)

    // Check if the target commit is the head of its stack
    if (isHeadOfStack(clonedStack, overSha)) {
      // If it's the head, append the dragging stack to the target's stack
      appendToStack(clonedStack, overSha, draggingStack)
    } else {
      // Otherwise, add the dragging stack as a spinoff
      addStackAsSpinoff(clonedStack, overSha, draggingStack)
    }

    return clonedStack
  } catch (error) {
    console.error('Error building optimistic drag:', error)
    return null
  }
}
