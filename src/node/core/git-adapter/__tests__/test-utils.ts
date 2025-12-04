/**
 * Test utilities for Git adapter testing
 */

import fs from 'fs'
import git from 'isomorphic-git'
import os from 'os'
import path from 'path'

/**
 * Create a temporary test repository
 */
export async function createTestRepo(): Promise<string> {
  const repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-adapter-test-'))

  await git.init({ fs, dir: repoPath, defaultBranch: 'main' })
  await git.setConfig({ fs, dir: repoPath, path: 'user.name', value: 'Test User' })
  await git.setConfig({ fs, dir: repoPath, path: 'user.email', value: 'test@example.com' })

  return repoPath
}

/**
 * Clean up a test repository
 */
export async function cleanupTestRepo(repoPath: string): Promise<void> {
  try {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a commit in a test repository using isomorphic-git
 */
export async function createCommit(
  repoPath: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  // Write files
  for (const [filepath, content] of Object.entries(files)) {
    const fullPath = path.join(repoPath, filepath)
    const dir = path.dirname(fullPath)

    // Ensure directory exists
    await fs.promises.mkdir(dir, { recursive: true })

    // Write file
    await fs.promises.writeFile(fullPath, content)

    // Stage file
    await git.add({ fs, dir: repoPath, filepath })
  }

  // Create commit
  return await git.commit({ fs, dir: repoPath, message })
}

/**
 * Create a branch in a test repository
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  checkout = false
): Promise<void> {
  await git.branch({ fs, dir: repoPath, ref: branchName, checkout })
}

/**
 * Get current HEAD SHA
 */
export async function getHeadSha(repoPath: string): Promise<string> {
  return await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
}

/**
 * Verify two objects are deeply equal (for testing)
 */
export function expectDeepEqual<T>(actual: T, expected: T, message?: string): void {
  const actualStr = JSON.stringify(actual, null, 2)
  const expectedStr = JSON.stringify(expected, null, 2)

  if (actualStr !== expectedStr) {
    throw new Error(
      `${message || 'Assertion failed'}\nExpected:\n${expectedStr}\n\nActual:\n${actualStr}`
    )
  }
}
