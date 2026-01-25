import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base } from '@playwright/test'

export interface GitRepoFixture {
  repoPath: string
  git: (command: string) => string
  createFile: (relativePath: string, content: string) => void
  commitFile: (relativePath: string, content: string, message: string) => void
  createBranch: (branchName: string) => void
  checkout: (branchName: string) => void
}

/**
 * Creates git helper functions for a repository at the given path.
 */
export function createGitHelpers(repoPath: string): Omit<GitRepoFixture, 'repoPath'> {
  function git(command: string): string {
    return execSync(`git ${command}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test User',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: repoPath
      }
    }).trim()
  }

  function createFile(relativePath: string, content: string): void {
    const fullPath = path.join(repoPath, relativePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, content)
  }

  function commitFile(relativePath: string, content: string, message: string): void {
    createFile(relativePath, content)
    git(`add "${relativePath}"`)
    git(`commit -m "${message}"`)
  }

  function createBranch(branchName: string): void {
    git(`checkout -b "${branchName}"`)
  }

  function checkout(branchName: string): void {
    git(`checkout "${branchName}"`)
  }

  return { git, createFile, commitFile, createBranch, checkout }
}

export interface GitRepoOptions {
  withInitialCommit?: boolean
  defaultBranch?: string
}

/**
 * Initializes a new git repository with optional initial commit.
 */
export function initializeRepo(
  repoPath: string,
  helpers: ReturnType<typeof createGitHelpers>,
  options: GitRepoOptions = {}
): void {
  const { withInitialCommit = true, defaultBranch = 'main' } = options

  helpers.git('init')
  helpers.git('config user.name "Test User"')
  helpers.git('config user.email "test@example.com"')
  helpers.git(`branch -M ${defaultBranch}`)

  if (withInitialCommit) {
    helpers.commitFile('README.md', '# Test Repository\n\nThis is a test repository for E2E tests.', 'Initial commit')
  }
}

/**
 * Creates an isolated git repository for testing.
 * The repo is created in a temp directory and cleaned up after the test.
 */
export function createGitRepoFixture(options: GitRepoOptions = {}) {
  return base.extend<{ gitRepo: GitRepoFixture }>({
    gitRepo: async ({}, use) => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-test-repo-'))
      const helpers = createGitHelpers(repoPath)

      initializeRepo(repoPath, helpers, options)

      await use({ repoPath, ...helpers })

      fs.rmSync(repoPath, { recursive: true, force: true })
    }
  })
}

export const testWithGitRepo = createGitRepoFixture()

/**
 * Creates a git repo with a complex history for testing stacked branches.
 * Structure:
 *   main: Initial commit -> Add entry point
 *   feature/auth: (from main) -> Add auth module -> Add logout function
 *   feature/auth-ui: (from feature/auth) -> Add auth UI component
 */
export function createStackedRepoFixture() {
  return base.extend<{ stackedRepo: GitRepoFixture }>({
    stackedRepo: async ({}, use) => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-stacked-repo-'))
      const helpers = createGitHelpers(repoPath)

      initializeRepo(repoPath, helpers, { withInitialCommit: false })

      helpers.commitFile('README.md', '# Test Project', 'Initial commit')
      helpers.commitFile('src/index.ts', 'console.log("hello")', 'Add entry point')

      helpers.createBranch('feature/auth')
      helpers.commitFile('src/auth.ts', 'export function login() {}', 'Add auth module')
      helpers.commitFile('src/auth.ts', 'export function login() {}\nexport function logout() {}', 'Add logout function')

      helpers.createBranch('feature/auth-ui')
      helpers.commitFile('src/auth-ui.tsx', '<button>Login</button>', 'Add auth UI component')

      helpers.checkout('main')

      await use({ repoPath, ...helpers })

      fs.rmSync(repoPath, { recursive: true, force: true })
    }
  })
}

export const testWithStackedRepo = createStackedRepoFixture()

/**
 * Creates a simple linear repo with multiple branches for basic testing.
 * Structure:
 *   main: Initial commit -> Add main entry
 *   feature/new-feature: (from main) -> Add new feature
 *   bugfix/fix-issue: (from main) -> Fix the issue
 */
export function createMultiBranchRepoFixture() {
  return base.extend<{ multiBranchRepo: GitRepoFixture }>({
    multiBranchRepo: async ({}, use) => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-multi-branch-'))
      const helpers = createGitHelpers(repoPath)

      initializeRepo(repoPath, helpers, { withInitialCommit: false })

      helpers.commitFile('README.md', '# Multi-Branch Test', 'Initial commit')
      helpers.commitFile('src/main.ts', 'export const VERSION = "1.0.0"', 'Add main entry')

      helpers.createBranch('feature/new-feature')
      helpers.commitFile('src/feature.ts', 'export function newFeature() {}', 'Add new feature')

      helpers.checkout('main')
      helpers.createBranch('bugfix/fix-issue')
      helpers.commitFile('src/fix.ts', 'export function fix() {}', 'Fix the issue')

      helpers.checkout('main')

      await use({ repoPath, ...helpers })

      fs.rmSync(repoPath, { recursive: true, force: true })
    }
  })
}

export const testWithMultiBranchRepo = createMultiBranchRepoFixture()
