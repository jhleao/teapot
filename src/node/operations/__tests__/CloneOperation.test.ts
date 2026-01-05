import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    addLocalRepo: vi.fn()
  }
}))

import { CloneOperation } from '../CloneOperation'

describe('CloneOperation.clone', () => {
  let sourceRepoPath: string
  let targetDir: string

  beforeEach(async () => {
    // Create a source repo to clone from
    sourceRepoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-clone-source-'))
    execSync('git init -b main', { cwd: sourceRepoPath })
    execSync('git config user.name "Test User"', { cwd: sourceRepoPath })
    execSync('git config user.email "test@example.com"', { cwd: sourceRepoPath })
    await fs.promises.writeFile(path.join(sourceRepoPath, 'file.txt'), 'content')
    execSync('git add .', { cwd: sourceRepoPath })
    execSync('git commit -m "initial commit"', { cwd: sourceRepoPath })

    // Create target directory
    targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-clone-target-'))
  })

  afterEach(async () => {
    await fs.promises.rm(sourceRepoPath, { recursive: true, force: true })
    await fs.promises.rm(targetDir, { recursive: true, force: true })
  })

  it('returns error when URL is empty', async () => {
    const result = await CloneOperation.clone('', targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Repository URL is required')
  })

  it('returns error when URL is whitespace only', async () => {
    const result = await CloneOperation.clone('   ', targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Repository URL is required')
  })

  it('returns error when targetPath is empty', async () => {
    const result = await CloneOperation.clone(sourceRepoPath, '')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Target path is required')
  })

  it('returns error when targetPath is whitespace only', async () => {
    const result = await CloneOperation.clone(sourceRepoPath, '   ')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Target path is required')
  })

  it('returns error when repo name cannot be extracted from URL', async () => {
    const result = await CloneOperation.clone('invalid-url-no-separator', targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not extract repository name from URL')
  })

  it('returns error when target directory already exists', async () => {
    // Rename source repo to have a predictable name for extraction
    const namedSourceRepo = path.join(path.dirname(sourceRepoPath), 'my-repo')
    await fs.promises.rename(sourceRepoPath, namedSourceRepo)
    sourceRepoPath = namedSourceRepo

    // Create the target subdirectory that would conflict
    await fs.promises.mkdir(path.join(targetDir, 'my-repo'))

    const result = await CloneOperation.clone(namedSourceRepo, targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Directory "my-repo" already exists in the target folder')
  })

  it('returns error with git message when clone fails', async () => {
    const result = await CloneOperation.clone('https://github.com/nonexistent/repo.git', targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // The exact error message depends on git, but it should contain something about the failure
    expect(result.error!.length).toBeGreaterThan(0)
  })

  it('clones repository and returns success with repoPath', async () => {
    // Rename source repo to have a predictable name
    const namedSourceRepo = path.join(path.dirname(sourceRepoPath), 'test-repo')
    await fs.promises.rename(sourceRepoPath, namedSourceRepo)
    sourceRepoPath = namedSourceRepo

    const result = await CloneOperation.clone(namedSourceRepo, targetDir)

    expect(result.success).toBe(true)
    expect(result.repoPath).toBe(path.join(targetDir, 'test-repo'))

    // Verify the clone exists and has the file
    const clonedFile = await fs.promises.readFile(
      path.join(targetDir, 'test-repo', 'file.txt'),
      'utf-8'
    )
    expect(clonedFile).toBe('content')

    // Verify it's a git repo
    const stat = await fs.promises.stat(path.join(targetDir, 'test-repo', '.git'))
    expect(stat.isDirectory()).toBe(true)
  })
})
