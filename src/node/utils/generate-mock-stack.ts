import type { UiStack } from '@shared/types'

const MOCK_BRANCH_NAMES = [
  'feature/auth',
  'feature/dashboard',
  'feature/api-refactor',
  'feature/performance',
  'feature/docs',
  'feature/testing',
  'feature/dashboard-stats',
  'feature/redis-cache',
  'feature/e2e-tests',
  'bugfix/error-handling',
  'bugfix/memory-leak',
  'bugfix/security',
  'feature/user-profile',
  'feature/file-upload',
  'feature/email-service',
  'feature/analytics',
  'feature/search',
  'feature/realtime',
  'feature/mobile-api',
  'feature/payment',
  'feature/oauth',
  'feature/export',
  'feature/reporting',
  'feature/backup',
  'feature/monitoring',
  'feature/deployment',
  'feature/optimization',
  'hotfix/critical',
  'feature/notifications',
  'feature/integration'
]

/**
 * Generates a random integer between min (inclusive) and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Gets a random branch name from MOCK_BRANCH_NAMES
 */
function getRandomBranchName(): string {
  return MOCK_BRANCH_NAMES[randomInt(0, MOCK_BRANCH_NAMES.length - 1)]
}

/**
 * Generates a mock stack with random commits and spinoffs
 * @param baseTime - Base timestamp for commits
 * @param timeStep - Time step between commits in milliseconds
 * @param commitCount - Number of commits to generate
 * @param depth - Current recursion depth (to prevent infinite recursion)
 * @param maxDepth - Maximum recursion depth
 * @param spinoffProbability - Probability (0-1) that a commit will have spinoffs
 */
export function generateMockStack(
  baseTime: number,
  timeStep: number = 7200000, // 2 hours default
  commitCount: number = randomInt(2, 5),
  depth: number = 0,
  maxDepth: number = 2,
  spinoffProbability: number = 0.4, // 40% chance = roughly 2 out of 5
  isTrunk: boolean = true
): UiStack {
  const commits: UiStack['commits'] = []

  for (let i = 0; i < commitCount; i++) {
    const commitTime = baseTime + i * timeStep
    const isLastCommit = i === commitCount - 1

    // Determine if this commit should have spinoffs
    // For main stack (depth 0), use pattern: every 5 commits, positions 3 and 5
    // For nested stacks, use random probability
    let hasSpinoff = false
    if (depth === 0) {
      const positionInGroup = (i % 5) + 1
      hasSpinoff = positionInGroup === 3 || positionInGroup === 5
    } else {
      hasSpinoff = Math.random() < spinoffProbability && depth < maxDepth
    }

    // Generate spinoffs if applicable
    // NEVER create spinoffs for the last commit in a stack
    const spinoffs: UiStack[] = []
    if (hasSpinoff && depth < maxDepth && !isLastCommit) {
      // Random number of spinoffs (1-3)
      const numSpinoffs = randomInt(1, depth === 0 ? 3 : 2)

      for (let j = 0; j < numSpinoffs; j++) {
        // Spinoff commits start after this commit
        const spinoffStartTime = commitTime + timeStep * (j + 1)
        // Random number of commits in spinoff (2-5, fewer for deeper levels)
        const spinoffCommitCount = randomInt(2, depth === 0 ? 5 : 3)

        spinoffs.push(
          generateMockStack(
            spinoffStartTime,
            timeStep,
            spinoffCommitCount,
            depth + 1,
            maxDepth,
            spinoffProbability * 0.7, // Reduce probability for nested spinoffs
            false
          )
        )
      }
    }

    // Generate commit name
    const commitName = generateCommitName(i, commitCount, depth, isLastCommit)

    // Determine branch info - commits can be tips of multiple branches
    const branches: Array<{ name: string; isCurrent: boolean }> = []

    if (depth === 0) {
      // Main stack commits are always on main branch
      branches.push({ name: 'main', isCurrent: isLastCommit && depth === 0 })

      // Last commit might also be tip of other branches
      if (isLastCommit) {
        const additionalBranch = getRandomBranchName()
        branches.push({ name: additionalBranch, isCurrent: false })
      }
    } else {
      // For spinoff commits, they're tips of their feature branch
      const branchName = getRandomBranchName()
      branches.push({ name: branchName, isCurrent: isLastCommit })

      // Sometimes commits can be tips of multiple branches (e.g., merged branches)
      if (isLastCommit && Math.random() < 0.3) {
        const additionalBranch = getRandomBranchName()
        if (additionalBranch !== branchName) {
          branches.push({ name: additionalBranch, isCurrent: false })
        }
      }
    }

    commits.push({
      sha: crypto.randomUUID(),
      name: commitName,
      timestampMs: commitTime,
      spinoffs,
      branches
    })
  }

  return { commits, isTrunk }
}

/**
 * Generates a commit message based on position and context
 */
function generateCommitName(
  index: number,
  totalCommits: number,
  depth: number,
  isLastCommit: boolean
): string {
  const mainCommitNames = [
    'Initial commit',
    'Add basic project structure',
    'Implement core functionality',
    'Add tests for core module',
    'Refactor API layer',
    'Add database migrations',
    'Implement user authentication',
    'Add error handling middleware',
    'Optimize database queries',
    'Add logging infrastructure',
    'Implement caching layer',
    'Add API rate limiting',
    'Create admin dashboard',
    'Add user profile management',
    'Implement file upload system',
    'Add email notification service',
    'Create analytics module',
    'Implement search functionality',
    'Add real-time updates',
    'Create mobile API endpoints',
    'Add payment integration',
    'Implement OAuth providers',
    'Add data export feature',
    'Create reporting system',
    'Implement backup system',
    'Add monitoring and alerts',
    'Create deployment scripts',
    'Add performance optimizations',
    'Fix critical security issues',
    'Finalize release v1.0'
  ]

  if (depth === 0 && index < mainCommitNames.length) {
    return mainCommitNames[index]
  }

  // For nested commits or beyond main list, generate descriptive names
  const actions = ['Implement', 'Add', 'Create', 'Fix', 'Refactor', 'Update', 'Optimize', 'Remove']
  const features = [
    'feature',
    'component',
    'module',
    'functionality',
    'integration',
    'endpoint',
    'service',
    'handler',
    'utility',
    'helper'
  ]

  const action = actions[randomInt(0, actions.length - 1)]
  const feature = features[randomInt(0, features.length - 1)]

  if (isLastCommit) {
    return `${action} ${feature} (final)`
  }

  return `${action} ${feature} (${index + 1}/${totalCommits})`
}
