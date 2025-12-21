/**
 * Git Adapter Utilities
 *
 * Higher-level utility functions built on top of the git adapter.
 * These provide common operations that combine multiple adapter calls.
 */

import { log as logger } from '@shared/logger'
import { exec } from 'child_process'
import { promisify } from 'util'
import { TRUNK_BRANCHES } from '../../shared/constants'
import { getGitAdapter } from './factory'

const execAsync = promisify(exec)

/**
 * Checks if a branch exists in the repository.
 */
export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    const adapter = getGitAdapter()
    const branches = await adapter.listBranches(repoPath)
    return branches.includes(branchName)
  } catch {
    return false
  }
}

/**
 * Finds the local trunk branch by checking common trunk branch names.
 * Returns the first matching trunk branch, or null if none found.
 */
export async function findLocalTrunk(repoPath: string): Promise<string | null> {
  for (const name of TRUNK_BRANCHES) {
    if (await branchExists(repoPath, name)) {
      return name
    }
  }
  return null
}

/**
 * Checks if localBranch can be fast-forwarded to remoteBranch.
 * Returns true if localBranch is an ancestor of remoteBranch.
 */
export async function canFastForward(
  repoPath: string,
  localBranch: string,
  remoteBranch: string
): Promise<boolean> {
  try {
    const adapter = getGitAdapter()
    return await adapter.isAncestor(repoPath, localBranch, remoteBranch)
  } catch {
    return false
  }
}

/**
 * Resolves the trunk branch reference from remote HEAD or common trunk names.
 * Returns the branch name (e.g., 'main', 'master') or null if none found.
 */
export async function resolveTrunkRef(
  repoPath: string,
  branches: string[]
): Promise<string | null> {
  const adapter = getGitAdapter()

  // Try to resolve from origin/HEAD - if we can find a trunk branch that matches
  try {
    const originHeadSha = await adapter.resolveRef(repoPath, 'refs/remotes/origin/HEAD')
    // Check which trunk branch matches this SHA
    for (const trunkName of TRUNK_BRANCHES) {
      if (branches.includes(trunkName)) {
        try {
          const branchSha = await adapter.resolveRef(repoPath, `refs/remotes/origin/${trunkName}`)
          if (branchSha === originHeadSha) {
            return trunkName
          }
        } catch {
          continue
        }
      }
    }
  } catch {
    // origin/HEAD doesn't exist or can't be resolved - fall through to fallback
  }

  // Fallback: Common trunk branch names in order of preference
  return TRUNK_BRANCHES.find((name) => branches.includes(name)) || branches[0] || null
}

export interface AuthorIdentity {
  name: string
  email: string
}

/**
 * Gets the git author identity for the repository.
 * Tries repo-level config first, then falls back to system-level git config.
 */
export async function getAuthorIdentity(repoPath: string): Promise<AuthorIdentity> {
  const adapter = getGitAdapter()

  try {
    const name = await adapter.getConfig(repoPath, 'user.name')
    const email = await adapter.getConfig(repoPath, 'user.email')

    if (name && email) {
      return { name, email }
    }

    const systemName = name || (await getSystemGitConfig('user.name'))
    const systemEmail = email || (await getSystemGitConfig('user.email'))

    if (systemName && systemEmail) return { name: systemName, email: systemEmail }
  } catch (error) {
    logger.warn('Failed to resolve git author identity:', error)
  }

  throw new Error('Failed to resolve git author identity')
}

async function getSystemGitConfig(key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`git config ${key}`)
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}
