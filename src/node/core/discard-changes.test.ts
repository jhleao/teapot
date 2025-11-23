import fs from 'fs'
import git from 'isomorphic-git'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discardChanges } from './discard-changes'

describe('discardChanges', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-'))
    await git.init({ fs, dir: repoPath, defaultBranch: 'main' })

    // Config is needed for commits
    await git.setConfig({
      fs,
      dir: repoPath,
      path: 'user.name',
      value: 'Test User'
    })
    await git.setConfig({
      fs,
      dir: repoPath,
      path: 'user.email',
      value: 'test@example.com'
    })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should discard staged changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })
    await git.commit({ fs, dir: repoPath, message: 'initial commit' })

    // Modify and stage
    await fs.promises.writeFile(filePath, 'modified content')
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })

    await discardChanges(repoPath)

    const content = await fs.promises.readFile(filePath, 'utf-8')
    expect(content).toBe('initial content')
  })

  it('should discard unstaged changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })
    await git.commit({ fs, dir: repoPath, message: 'initial commit' })

    // Modify but do not stage
    await fs.promises.writeFile(filePath, 'modified content')

    await discardChanges(repoPath)

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
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })
    await git.commit({ fs, dir: repoPath, message: 'initial commit' })

    // Modify and stage
    await fs.promises.writeFile(filePath, 'staged content')
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })

    // Modify again (unstaged)
    await fs.promises.writeFile(filePath, 'unstaged content')

    await discardChanges(repoPath)

    const content = await fs.promises.readFile(filePath, 'utf-8')
    expect(content).toBe('initial content')
  })

  it('should discard mixed staged and unstaged files', async () => {
    const file1 = path.join(repoPath, 'file1.txt')
    const file2 = path.join(repoPath, 'file2.txt')

    await fs.promises.writeFile(file1, 'initial 1')
    await fs.promises.writeFile(file2, 'initial 2')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })
    await git.add({ fs, dir: repoPath, filepath: 'file2.txt' })
    await git.commit({ fs, dir: repoPath, message: 'initial' })

    // file1: modify and stage
    await fs.promises.writeFile(file1, 'modified 1')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })

    // file2: modify (unstaged)
    await fs.promises.writeFile(file2, 'modified 2')

    await discardChanges(repoPath)

    expect(await fs.promises.readFile(file1, 'utf-8')).toBe('initial 1')
    expect(await fs.promises.readFile(file2, 'utf-8')).toBe('initial 2')
  })

  it('should delete untracked files', async () => {
    const filePath = path.join(repoPath, 'untracked.txt')
    await fs.promises.writeFile(filePath, 'new file')

    await discardChanges(repoPath)

    // Expect file to be gone
    await expect(fs.promises.access(filePath)).rejects.toThrow()
  })

  it('should discard staged new file', async () => {
    const file2 = path.join(repoPath, 'new-staged.txt')
    await fs.promises.writeFile(file2, 'new file')
    await git.add({ fs, dir: repoPath, filepath: 'new-staged.txt' })

    await discardChanges(repoPath)

    await expect(fs.promises.access(file2)).rejects.toThrow()
  })

  it('should remain on the same branch after discarding changes', async () => {
    const filePath = path.join(repoPath, 'file.txt')
    await fs.promises.writeFile(filePath, 'initial content')
    await git.add({ fs, dir: repoPath, filepath: 'file.txt' })
    await git.commit({ fs, dir: repoPath, message: 'initial commit' })

    // Create and switch to a new branch
    await git.branch({ fs, dir: repoPath, ref: 'feature-branch' })
    await git.checkout({ fs, dir: repoPath, ref: 'feature-branch' })

    // Verify we are on feature-branch
    let currentBranch = await git.currentBranch({ fs, dir: repoPath })
    expect(currentBranch).toBe('feature-branch')

    // Modify file
    await fs.promises.writeFile(filePath, 'modified content')

    // Discard changes
    await discardChanges(repoPath)

    // Verify we are still on feature-branch
    currentBranch = await git.currentBranch({ fs, dir: repoPath })
    expect(currentBranch).toBe('feature-branch')
  })
})
