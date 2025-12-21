/**
 * Test utilities for Git adapter testing
 *
 * Uses native Git CLI for test setup to ensure maximum reliability
 * and remove dependency on any particular Git library.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Create a temporary test repository using native Git CLI
 */
export async function createTestRepo(): Promise<string> {
  const repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-adapter-test-'))

  // Use native Git CLI for maximum reliability
  execSync('git init -b main', { cwd: repoPath })
  execSync('git config user.name "Test User"', { cwd: repoPath })
  execSync('git config user.email "test@example.com"', { cwd: repoPath })

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
 * Create a commit in a test repository using native Git CLI
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
  }

  // Stage and commit using Git CLI
  execSync('git add -A', { cwd: repoPath })
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: repoPath })

  // Get commit SHA
  const sha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()
  return sha
}

/**
 * Create a branch in a test repository using Git CLI
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  checkout = false
): Promise<void> {
  if (checkout) {
    execSync(`git checkout -b ${branchName}`, { cwd: repoPath })
  } else {
    execSync(`git branch ${branchName}`, { cwd: repoPath })
  }
}

/**
 * Get current HEAD SHA using Git CLI
 */
export async function getHeadSha(repoPath: string): Promise<string> {
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()
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
