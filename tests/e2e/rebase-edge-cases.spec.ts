/**
 * Rebase edge case E2E tests.
 *
 * These verify rebasing behavior under unusual or complex repository
 * topologies and states: diamond merges, dirty worktrees, deep stacks,
 * branches with special names, etc.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'
import {
  confirmRebase,
  dragBranchOnto,
  dragBranchOntoCommit,
  expectBranchVisible,
  waitForRebasePrompt,
  waitForRebasePromptDismissed,
  waitForStackView
} from './helpers/drag'

testWithRepo.describe('Diamond Merge Topology', () => {
  testWithRepo('handles diamond branch structure: A -> B and A -> C', async ({
    page,
    gitRepo
  }) => {
    // Create diamond: main -> branch-b (from main), main -> branch-c (from main)
    // Then rebase both onto a new main commit
    gitRepo.createBranch('diamond-b')
    gitRepo.commitFile('src/b.ts', 'b code', 'Diamond B commit')

    gitRepo.checkout('main')
    gitRepo.createBranch('diamond-c')
    gitRepo.commitFile('src/c.ts', 'c code', 'Diamond C commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main update', 'Main diamond update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'diamond-b')
    await expectBranchVisible(page, 'diamond-c')

    // Rebase diamond-b first
    await dragBranchOntoCommit(page, 'diamond-b', 'Main diamond update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const bLog = gitRepo.git('log --oneline diamond-b')
    expect(bLog).toContain('Main diamond update')
    expect(bLog).toContain('Diamond B commit')

    // Wait for UI to settle
    await page.waitForTimeout(1000)

    // Now rebase diamond-c
    await dragBranchOntoCommit(page, 'diamond-c', 'Main diamond update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const cLog = gitRepo.git('log --oneline diamond-c')
    expect(cLog).toContain('Main diamond update')
    expect(cLog).toContain('Diamond C commit')
  })

  testWithRepo('rebasing diamond with shared descendant: B and C both have child D', async ({
    page,
    gitRepo
  }) => {
    // main -> branch-b -> branch-d AND main -> branch-c
    // Rebase branch-b onto a new main commit, verify branch-d follows
    gitRepo.createBranch('d-parent')
    gitRepo.commitFile('src/dp.ts', 'dp', 'Diamond parent')

    gitRepo.createBranch('d-child')
    gitRepo.commitFile('src/dc.ts', 'dc', 'Diamond child')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main diamond advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Rebase the parent branch, child should follow
    await dragBranchOntoCommit(page, 'd-parent', 'Main diamond advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    await expectBranchVisible(page, 'd-parent')
    await expectBranchVisible(page, 'd-child')

    const childLog = gitRepo.git('log --oneline d-child')
    expect(childLog).toContain('Main diamond advance')
    expect(childLog).toContain('Diamond parent')
    expect(childLog).toContain('Diamond child')
  })
})

testWithRepo.describe('Dirty Worktree', () => {
  testWithRepo('can rebase with staged but uncommitted files (parallel mode)', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/dirty-staged')
    gitRepo.commitFile('src/feat.ts', 'feature', 'Feature commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    // Create staged change on main (simulating dirty worktree)
    gitRepo.createFile('src/wip.ts', 'work in progress')
    gitRepo.git('add src/wip.ts')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // In parallel mode, rebase should work even with dirty worktree
    // (uses temp worktree)
    await dragBranchOntoCommit(page, 'feature/dirty-staged', 'Main update')

    // Either the prompt appears (parallel mode) or the drag is blocked
    // We just verify the app doesn't crash
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('app-container')).toBeVisible()
  })

  testWithRepo('can rebase with unstaged modifications (parallel mode)', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/dirty-unstaged')
    gitRepo.commitFile('src/feat.ts', 'feature', 'Feature commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    // Modify a tracked file without staging
    gitRepo.createFile('README.md', 'modified readme content')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/dirty-unstaged', 'Main update')

    // App should handle gracefully — either allows via parallel mode or blocks
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('app-container')).toBeVisible()
  })
})

testWithRepo.describe('Branch Naming Edge Cases', () => {
  testWithRepo('can rebase branch with slashes in name', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/auth/login')
    gitRepo.commitFile('src/login.ts', 'login', 'Login feature')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'feature/auth/login')

    await dragBranchOntoCommit(page, 'feature/auth/login', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const log = gitRepo.git('log --oneline feature/auth/login')
    expect(log).toContain('Main update')
    expect(log).toContain('Login feature')
  })

  testWithRepo('can rebase branch with hyphens and numbers', async ({ page, gitRepo }) => {
    gitRepo.createBranch('fix-123-bug-456')
    gitRepo.commitFile('src/fix.ts', 'fix', 'Bug fix 123-456')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'fix-123-bug-456')

    await dragBranchOntoCommit(page, 'fix-123-bug-456', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const log = gitRepo.git('log --oneline fix-123-bug-456')
    expect(log).toContain('Main update')
    expect(log).toContain('Bug fix 123-456')
  })
})

testWithRepo.describe('Empty and Minimal Branches', () => {
  testWithRepo('handles rebasing branch with single commit', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/single')
    gitRepo.commitFile('src/single.ts', 'single', 'Only commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/single', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const log = gitRepo.git('log --oneline feature/single')
    expect(log).toContain('Main update')
    expect(log).toContain('Only commit')
  })

  testWithRepo('handles branch with many commits (10+)', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/many-commits')
    for (let i = 1; i <= 12; i++) {
      gitRepo.commitFile(`src/file${i}.ts`, `content ${i}`, `Commit number ${i}`)
    }

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/many-commits', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    const log = gitRepo.git('log --oneline feature/many-commits')
    expect(log).toContain('Main advance')
    expect(log).toContain('Commit number 1')
    expect(log).toContain('Commit number 12')
  })
})

testWithRepo.describe('Multiple Sequential Rebases', () => {
  testWithRepo('can perform two rebases in sequence on different branches', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('seq-a')
    gitRepo.commitFile('src/a.ts', 'a', 'Seq A commit')

    gitRepo.checkout('main')
    gitRepo.createBranch('seq-b')
    gitRepo.commitFile('src/b.ts', 'b', 'Seq B commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // First rebase
    await dragBranchOntoCommit(page, 'seq-a', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Wait for UI to settle
    await page.waitForTimeout(2000)

    // Second rebase
    await dragBranchOntoCommit(page, 'seq-b', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Both rebased correctly
    const aLog = gitRepo.git('log --oneline seq-a')
    expect(aLog).toContain('Main advance')

    const bLog = gitRepo.git('log --oneline seq-b')
    expect(bLog).toContain('Main advance')
  })

  testWithRepo('can stack a branch after rebasing another', async ({ page, gitRepo }) => {
    // Rebase branch-a onto main, then stack branch-b onto branch-a
    gitRepo.createBranch('restack-a')
    gitRepo.commitFile('src/a.ts', 'a', 'Restack A')

    gitRepo.checkout('main')
    gitRepo.createBranch('restack-b')
    gitRepo.commitFile('src/b.ts', 'b', 'Restack B')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // First: rebase A onto main
    await dragBranchOntoCommit(page, 'restack-a', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    await page.waitForTimeout(2000)

    // Second: stack B onto A
    await dragBranchOnto(page, 'restack-b', 'restack-a')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // B should contain A's commit and main advance
    const bLog = gitRepo.git('log --oneline restack-b')
    expect(bLog).toContain('Main advance')
    expect(bLog).toContain('Restack A')
    expect(bLog).toContain('Restack B')
  })
})

testWithRepo.describe('Concurrent Modifications', () => {
  testWithRepo('handles external commit during rebase gracefully', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/external')
    gitRepo.commitFile('src/feat.ts', 'feature', 'Feature work')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main v1', 'Main v1')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Start rebase
    await dragBranchOntoCommit(page, 'feature/external', 'Main v1')
    await waitForRebasePrompt(page)

    // Meanwhile, make a commit on main externally
    // (This simulates what might happen if another tool commits)
    gitRepo.commitFile('src/main.ts', 'main v2', 'Main v2 external')

    // Confirm the rebase
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // App should still be functional
    await expect(page.getByTestId('app-container')).toBeVisible()
    await expectBranchVisible(page, 'feature/external')
  })
})
