/**
 * Multi-branch stack rebase E2E tests.
 *
 * These verify that rebasing correctly cascades through stacked branches,
 * maintaining the correct topology and updating all child branches.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'
import {
  confirmRebase,
  dragBranchOnto,
  dragBranchOntoCommit,
  expectBranchVisible,
  getAllVisibleCommits,
  waitForRebasePrompt,
  waitForRebasePromptDismissed,
  waitForStackView
} from './helpers/drag'

testWithRepo.describe('Stack Rebase - Single Child', () => {
  testWithRepo('rebasing parent cascades to child branch', async ({ page, gitRepo }) => {
    // Stack: main -> feature/parent -> feature/child
    gitRepo.createBranch('feature/parent')
    gitRepo.commitFile('src/parent.ts', 'parent', 'Parent commit')

    gitRepo.createBranch('feature/child')
    gitRepo.commitFile('src/child.ts', 'child', 'Child commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main advance', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'feature/parent')
    await expectBranchVisible(page, 'feature/child')

    // Rebase the parent onto main's latest
    await dragBranchOntoCommit(page, 'feature/parent', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Both branches should still be visible
    await expectBranchVisible(page, 'feature/parent')
    await expectBranchVisible(page, 'feature/child')

    // Verify parent was rebased
    const parentLog = gitRepo.git('log --oneline feature/parent')
    expect(parentLog).toContain('Main advance')
    expect(parentLog).toContain('Parent commit')

    // Verify child was cascaded (also contains main advance)
    const childLog = gitRepo.git('log --oneline feature/child')
    expect(childLog).toContain('Main advance')
    expect(childLog).toContain('Parent commit')
    expect(childLog).toContain('Child commit')
  })

  testWithRepo('rebasing parent preserves child commit content', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/base')
    gitRepo.commitFile('src/base.ts', 'base content', 'Base setup')

    gitRepo.createBranch('feature/extension')
    gitRepo.commitFile('src/extension.ts', 'extension content', 'Extension work')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/infra.ts', 'infra', 'Infrastructure update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/base', 'Infrastructure update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Verify file contents are preserved on child branch
    const files = gitRepo.git('ls-tree --name-only -r feature/extension')
    expect(files).toContain('src/base.ts')
    expect(files).toContain('src/extension.ts')
    expect(files).toContain('src/infra.ts')
  })
})

testWithRepo.describe('Stack Rebase - Multiple Children', () => {
  testWithRepo('rebasing parent cascades to all sibling children', async ({ page, gitRepo }) => {
    // Stack: main -> feature/parent -> feature/child-a AND feature/child-b
    gitRepo.createBranch('feature/parent')
    gitRepo.commitFile('src/parent.ts', 'parent code', 'Parent work')

    gitRepo.createBranch('feature/child-a')
    gitRepo.commitFile('src/child-a.ts', 'child a', 'Child A work')

    gitRepo.checkout('feature/parent')
    gitRepo.createBranch('feature/child-b')
    gitRepo.commitFile('src/child-b.ts', 'child b', 'Child B work')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main code', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Rebase parent
    await dragBranchOntoCommit(page, 'feature/parent', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // All branches should still be visible
    await expectBranchVisible(page, 'feature/parent')
    await expectBranchVisible(page, 'feature/child-a')
    await expectBranchVisible(page, 'feature/child-b')

    // Both children should contain the main update
    const childALog = gitRepo.git('log --oneline feature/child-a')
    expect(childALog).toContain('Main update')
    expect(childALog).toContain('Child A work')

    const childBLog = gitRepo.git('log --oneline feature/child-b')
    expect(childBLog).toContain('Main update')
    expect(childBLog).toContain('Child B work')
  })
})

testWithRepo.describe('Stack Rebase - Deep Stacks', () => {
  testWithRepo('rebasing root of 3-level stack cascades to all levels', async ({
    page,
    gitRepo
  }) => {
    // Stack: main -> level1 -> level2 -> level3
    gitRepo.createBranch('level1')
    gitRepo.commitFile('src/l1.ts', 'level 1', 'Level 1 commit')

    gitRepo.createBranch('level2')
    gitRepo.commitFile('src/l2.ts', 'level 2', 'Level 2 commit')

    gitRepo.createBranch('level3')
    gitRepo.commitFile('src/l3.ts', 'level 3', 'Level 3 commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main update', 'Main deep update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'level1', 'Main deep update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // All 3 levels should still exist
    await expectBranchVisible(page, 'level1')
    await expectBranchVisible(page, 'level2')
    await expectBranchVisible(page, 'level3')

    // Deepest level should contain everything
    const log = gitRepo.git('log --oneline level3')
    expect(log).toContain('Main deep update')
    expect(log).toContain('Level 1 commit')
    expect(log).toContain('Level 2 commit')
    expect(log).toContain('Level 3 commit')
  })

  testWithRepo('rebasing middle of 3-level stack only affects it and children', async ({
    page,
    gitRepo
  }) => {
    // Stack: main -> level1 -> level2 -> level3
    // Rebase level2 onto main (level1 stays, level2+level3 move)
    gitRepo.createBranch('level1')
    gitRepo.commitFile('src/l1.ts', 'l1', 'Level 1')

    gitRepo.createBranch('level2')
    gitRepo.commitFile('src/l2.ts', 'l2', 'Level 2')

    gitRepo.createBranch('level3')
    gitRepo.commitFile('src/l3.ts', 'l3', 'Level 3')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Get level1 SHA before rebase
    const level1ShaBefore = gitRepo.git('rev-parse level1')

    // Rebase level2 onto main — this detaches it from level1
    await dragBranchOntoCommit(page, 'level2', 'Initial commit')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // level1 should be unchanged
    const level1ShaAfter = gitRepo.git('rev-parse level1')
    expect(level1ShaAfter).toBe(level1ShaBefore)

    // level2 should no longer contain level1's commit
    const level2Log = gitRepo.git('log --oneline level2')
    expect(level2Log).toContain('Level 2')
    expect(level2Log).not.toContain('Level 1')

    // level3 should follow level2
    const level3Log = gitRepo.git('log --oneline level3')
    expect(level3Log).toContain('Level 2')
    expect(level3Log).toContain('Level 3')
    expect(level3Log).not.toContain('Level 1')
  })

  testWithRepo('rebasing 4-level deep stack preserves full chain', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('stack-a')
    gitRepo.commitFile('src/a.ts', 'a', 'Stack A')

    gitRepo.createBranch('stack-b')
    gitRepo.commitFile('src/b.ts', 'b', 'Stack B')

    gitRepo.createBranch('stack-c')
    gitRepo.commitFile('src/c.ts', 'c', 'Stack C')

    gitRepo.createBranch('stack-d')
    gitRepo.commitFile('src/d.ts', 'd', 'Stack D')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main bump')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'stack-a', 'Main bump')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // All 4 levels visible
    await expectBranchVisible(page, 'stack-a')
    await expectBranchVisible(page, 'stack-b')
    await expectBranchVisible(page, 'stack-c')
    await expectBranchVisible(page, 'stack-d')

    // Deepest branch has all commits
    const log = gitRepo.git('log --oneline stack-d')
    expect(log).toContain('Main bump')
    expect(log).toContain('Stack A')
    expect(log).toContain('Stack B')
    expect(log).toContain('Stack C')
    expect(log).toContain('Stack D')
  })
})

testWithRepo.describe('Stack Rebase - Reordering', () => {
  testWithRepo('can move a branch from one parent to another', async ({ page, gitRepo }) => {
    // feature-a and feature-b are both off main
    // Move feature-b to be on top of feature-a
    gitRepo.createBranch('feature-a')
    gitRepo.commitFile('src/a.ts', 'a', 'Feature A commit')

    gitRepo.checkout('main')
    gitRepo.createBranch('feature-b')
    gitRepo.commitFile('src/b.ts', 'b', 'Feature B commit')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Drag feature-b onto feature-a
    await dragBranchOnto(page, 'feature-b', 'feature-a')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Verify feature-b is now stacked on feature-a
    const log = gitRepo.git('log --oneline feature-b')
    expect(log).toContain('Feature A commit')
    expect(log).toContain('Feature B commit')
  })

  testWithRepo('can move a child branch to become a sibling', async ({ page, gitRepo }) => {
    // main -> parent -> child, then move child to be off main
    gitRepo.createBranch('feature/parent')
    gitRepo.commitFile('src/parent.ts', 'parent', 'Parent setup')

    gitRepo.createBranch('feature/child')
    gitRepo.commitFile('src/child.ts', 'child', 'Child setup')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Drag child onto main's commit (detach from parent)
    await dragBranchOntoCommit(page, 'feature/child', 'Initial commit')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Child should no longer contain parent's commit
    const childLog = gitRepo.git('log --oneline feature/child')
    expect(childLog).toContain('Child setup')
    expect(childLog).not.toContain('Parent setup')

    // Parent should be unchanged
    const parentLog = gitRepo.git('log --oneline feature/parent')
    expect(parentLog).toContain('Parent setup')
  })
})
