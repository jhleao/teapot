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
    const result = await CloneOperation.clone('https://github.com/user/repo', '')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Target path is required')
  })

  it('returns error when targetPath is whitespace only', async () => {
    const result = await CloneOperation.clone('https://github.com/user/repo', '   ')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Target path is required')
  })

  it('returns error when URL format is invalid', async () => {
    const result = await CloneOperation.clone('invalid-url-no-separator', targetDir)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid Git URL format')
  })

  it('returns error when target directory already exists', async () => {
    // Rename source repo to have a predictable name for extraction
    const namedSourceRepo = path.join(path.dirname(sourceRepoPath), 'my-repo')
    await fs.promises.rename(sourceRepoPath, namedSourceRepo)
    sourceRepoPath = namedSourceRepo

    // Create the target subdirectory that would conflict
    await fs.promises.mkdir(path.join(targetDir, 'my-repo'))

    // Use file:// protocol for local path
    const result = await CloneOperation.clone(`file://${namedSourceRepo}`, targetDir)

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

    // Use file:// protocol for local path
    const result = await CloneOperation.clone(`file://${namedSourceRepo}`, targetDir)

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

  it('uses custom folder name when provided', async () => {
    // Rename source repo to have a predictable name
    const namedSourceRepo = path.join(path.dirname(sourceRepoPath), 'original-name')
    await fs.promises.rename(sourceRepoPath, namedSourceRepo)
    sourceRepoPath = namedSourceRepo

    // Use file:// protocol for local path, with custom folder name
    const result = await CloneOperation.clone(
      `file://${namedSourceRepo}`,
      targetDir,
      'custom-folder-name'
    )

    expect(result.success).toBe(true)
    expect(result.repoPath).toBe(path.join(targetDir, 'custom-folder-name'))

    // Verify the clone exists
    const stat = await fs.promises.stat(path.join(targetDir, 'custom-folder-name', '.git'))
    expect(stat.isDirectory()).toBe(true)
  })
})

describe('CloneOperation.checkFolderName', () => {
  let targetDir: string

  beforeEach(async () => {
    targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-check-folder-'))
  })

  afterEach(async () => {
    await fs.promises.rm(targetDir, { recursive: true, force: true })
  })

  it('returns exists: false when folder does not exist', async () => {
    const result = await CloneOperation.checkFolderName(targetDir, 'nonexistent')

    expect(result.exists).toBe(false)
    expect(result.suggestion).toBeUndefined()
  })

  it('returns exists: true with suggestion when folder exists', async () => {
    await fs.promises.mkdir(path.join(targetDir, 'my-repo'))

    const result = await CloneOperation.checkFolderName(targetDir, 'my-repo')

    expect(result.exists).toBe(true)
    expect(result.suggestion).toBe('my-repo-2')
  })

  it('suggests incrementing number when multiple folders exist', async () => {
    await fs.promises.mkdir(path.join(targetDir, 'my-repo'))
    await fs.promises.mkdir(path.join(targetDir, 'my-repo-2'))
    await fs.promises.mkdir(path.join(targetDir, 'my-repo-3'))

    const result = await CloneOperation.checkFolderName(targetDir, 'my-repo')

    expect(result.exists).toBe(true)
    expect(result.suggestion).toBe('my-repo-4')
  })
})

describe('CloneOperation.checkTargetPath', () => {
  let targetDir: string

  beforeEach(async () => {
    targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-check-target-'))
  })

  afterEach(async () => {
    await fs.promises.rm(targetDir, { recursive: true, force: true })
  })

  it('returns valid: true for existing writable directory', async () => {
    const result = await CloneOperation.checkTargetPath(targetDir)

    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns error for empty path', async () => {
    const result = await CloneOperation.checkTargetPath('')

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Target path is required')
  })

  it('returns error for non-existent directory', async () => {
    const result = await CloneOperation.checkTargetPath('/nonexistent/path/that/does/not/exist')

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Directory does not exist')
  })

  it('returns error when path is a file, not directory', async () => {
    const filePath = path.join(targetDir, 'file.txt')
    await fs.promises.writeFile(filePath, 'content')

    const result = await CloneOperation.checkTargetPath(filePath)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path is not a directory')
  })
})
