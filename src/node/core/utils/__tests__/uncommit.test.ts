import fs from 'fs'
import git from 'isomorphic-git'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { uncommit } from '../uncommit'

describe('uncommit', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-uncommit-'))
    await git.init({ fs, dir: repoPath, defaultBranch: 'main' })
    // Config is needed for commits
    await git.setConfig({ fs, dir: repoPath, path: 'user.name', value: 'Test User' })
    await git.setConfig({ fs, dir: repoPath, path: 'user.email', value: 'test@example.com' })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should uncommit HEAD, preserve changes as staged, delete branch, and land on parent branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })
    const commit1 = await git.commit({ fs, dir: repoPath, message: 'commit 1' })

    // Create feature branch
    await git.branch({ fs, dir: repoPath, ref: 'feature' })
    await git.checkout({ fs, dir: repoPath, ref: 'feature' })

    // Commit 2 on feature
    await fs.promises.writeFile(file1, 'modified')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })
    const commit2 = await git.commit({ fs, dir: repoPath, message: 'commit 2' })

    // Uncommit commit2
    await uncommit(repoPath, commit2)

    // Assertions
    // 1. HEAD should be at commit1
    const currentHead = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    expect(currentHead).toBe(commit1)

    // 2. Branch 'feature' should be gone
    const branches = await git.listBranches({ fs, dir: repoPath })
    expect(branches).not.toContain('feature')

    // 3. Should be on 'main' (since main points to commit1)
    const currentBranch = await git.currentBranch({ fs, dir: repoPath })
    expect(currentBranch).toBe('main')

    // 4. Changes should be in Index (staged)
    const matrix = await git.statusMatrix({ fs, dir: repoPath, filepaths: ['file1.txt'] })
    const [, head, workdir, stage] = matrix[0]

    // HEAD: 1 (exists and matches HEAD commit)
    // STAGE: 2 (exists but differs from HEAD - matches modified content)
    // WORKDIR: 2 (matches STAGE)
    expect(head).toBe(1)
    expect(stage).toBe(2)
    expect(workdir).toBe(2)
  })

  it('should detach if no parent branch exists', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })
    const commit1 = await git.commit({ fs, dir: repoPath, message: 'commit 1' })

    // Move main to commit 2
    await fs.promises.writeFile(file1, 'modified')
    await git.add({ fs, dir: repoPath, filepath: 'file1.txt' })
    const commit2 = await git.commit({ fs, dir: repoPath, message: 'commit 2' })

    // Uncommit commit2 (main will be deleted)
    await uncommit(repoPath, commit2)

    const currentHead = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    expect(currentHead).toBe(commit1)

    const branches = await git.listBranches({ fs, dir: repoPath })
    expect(branches).not.toContain('main')

    const currentBranch = await git.currentBranch({ fs, dir: repoPath })
    expect(currentBranch).toBeUndefined() // Detached

    const matrix = await git.statusMatrix({ fs, dir: repoPath, filepaths: ['file1.txt'] })
    const [, head, workdir, stage] = matrix[0]
    expect(head).toBe(1)
    expect(stage).toBe(2)
    expect(workdir).toBe(2)
  })
})
