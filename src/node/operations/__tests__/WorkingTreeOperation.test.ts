import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkingTreeOperation } from '../WorkingTreeOperation'

describe('discardChanges', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-'))
    execSync('git init', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should discard staged changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    execSync('git add file.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Modify and stage
    await fs.promises.writeFile(filePath, 'modified content')
    execSync('git add file.txt', { cwd: repoPath })

    await WorkingTreeOperation.discardChanges(repoPath)

    const content = await fs.promises.readFile(filePath, 'utf-8')
    expect(content).toBe('initial content')
  })

  it('should discard unstaged changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    execSync('git add file.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Modify but do not stage
    await fs.promises.writeFile(filePath, 'modified content')

    await WorkingTreeOperation.discardChanges(repoPath)

    const content = await fs.promises.readFile(filePath, 'utf-8')
    expect(content).toBe('initial content')
  })

  it('should discard changes when file is both staged and modified', async () => {
    // This scenario:
    // 1. modify -> stage
    // 2. modify again
    // discardChanges should revert to HEAD (initial content)

    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    execSync('git add file.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Modify and stage
    await fs.promises.writeFile(filePath, 'staged content')
    execSync('git add file.txt', { cwd: repoPath })

    // Modify again (unstaged)
    await fs.promises.writeFile(filePath, 'unstaged content')

    await WorkingTreeOperation.discardChanges(repoPath)

    const content = await fs.promises.readFile(filePath, 'utf-8')
    expect(content).toBe('initial content')
  })

  it('should discard mixed staged and unstaged files', async () => {
    const file1 = path.join(repoPath, 'file1.txt')
    const file2 = path.join(repoPath, 'file2.txt')

    await fs.promises.writeFile(file1, 'initial 1')
    await fs.promises.writeFile(file2, 'initial 2')
    execSync('git add file1.txt file2.txt', { cwd: repoPath })
    execSync('git commit -m "initial"', { cwd: repoPath })

    // file1: modify and stage
    await fs.promises.writeFile(file1, 'modified 1')
    execSync('git add file1.txt', { cwd: repoPath })

    // file2: modify (unstaged)
    await fs.promises.writeFile(file2, 'modified 2')

    await WorkingTreeOperation.discardChanges(repoPath)

    expect(await fs.promises.readFile(file1, 'utf-8')).toBe('initial 1')
    expect(await fs.promises.readFile(file2, 'utf-8')).toBe('initial 2')
  })

  it('should delete untracked files', async () => {
    // Create initial commit first
    const initialFile = path.join(repoPath, 'initial.txt')
    await fs.promises.writeFile(initialFile, 'initial')
    execSync('git add initial.txt', { cwd: repoPath })
    execSync('git commit -m "initial"', { cwd: repoPath })

    const filePath = path.join(repoPath, 'untracked.txt')
    await fs.promises.writeFile(filePath, 'new file')

    await WorkingTreeOperation.discardChanges(repoPath)

    // Expect file to be gone
    await expect(fs.promises.access(filePath)).rejects.toThrow()
  })

  it('should discard staged new file', async () => {
    // Create initial commit first
    const initialFile = path.join(repoPath, 'initial.txt')
    await fs.promises.writeFile(initialFile, 'initial')
    execSync('git add initial.txt', { cwd: repoPath })
    execSync('git commit -m "initial"', { cwd: repoPath })

    const file2 = path.join(repoPath, 'new-staged.txt')
    await fs.promises.writeFile(file2, 'new file')
    execSync('git add new-staged.txt', { cwd: repoPath })

    await WorkingTreeOperation.discardChanges(repoPath)

    await expect(fs.promises.access(file2)).rejects.toThrow()
  })

  it('should remain on the same branch after discarding changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    execSync('git add file.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Create and switch to a new branch
    execSync('git branch feature-branch', { cwd: repoPath })
    execSync('git checkout feature-branch', { cwd: repoPath })

    // Verify we are on feature-branch
    let currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('feature-branch')

    // Modify file
    await fs.promises.writeFile(filePath, 'modified content')

    // Discard changes
    await WorkingTreeOperation.discardChanges(repoPath)

    // Verify we are still on feature-branch
    currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('feature-branch')
  })
})
