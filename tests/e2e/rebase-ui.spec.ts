/**
 * Basic rebase UI tests (no conflicts).
 *
 * These verify that the drag-and-drop rebase flow works end-to-end
 * through the UI when no merge conflicts are involved.
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

testWithRepo.describe('Basic Rebase UI', () => {
  testWithRepo('can drag a branch onto main and see the rebase prompt', async ({
    page,
    gitRepo
  }) => {
    // Setup: main with commit, then a feature branch
    gitRepo.createBranch('feature/simple')
    gitRepo.commitFile('src/simple.ts', 'export const simple = true', 'Add simple feature')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main-update.ts', 'export const v2 = true', 'Update main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'feature/simple')

    // Drag the feature branch onto the latest main commit
    await dragBranchOntoCommit(page, 'feature/simple', 'Update main')

    // The rebase prompt (Cancel/Confirm) should appear
    await waitForRebasePrompt(page)

    // Verify both buttons are visible
    await expect(page.getByTestId('confirm-rebase-button')).toBeVisible()
    await expect(page.getByTestId('cancel-rebase-button')).toBeVisible()
  })

  testWithRepo('can confirm a rebase and see it complete', async ({ page, gitRepo }) => {
    // Setup: feature branch forked off main, then main advances
    gitRepo.createBranch('feature/rebase-me')
    gitRepo.commitFile('src/feature.ts', 'export function feat() {}', 'Add feature')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/update.ts', 'export const updated = true', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Drag and confirm
    await dragBranchOntoCommit(page, 'feature/rebase-me', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    // Wait for rebase to complete (prompt disappears)
    await waitForRebasePromptDismissed(page)

    // Branch should still be visible after rebase
    await expectBranchVisible(page, 'feature/rebase-me')

    // Verify via git that the branch was actually rebased
    const log = gitRepo.git('log --oneline feature/rebase-me')
    expect(log).toContain('Main advance')
    expect(log).toContain('Add feature')
  })

  testWithRepo('can cancel a rebase before confirming', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/cancel-test')
    gitRepo.commitFile('src/cancel.ts', 'export const cancel = true', 'Add cancel feature')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main2.ts', 'export const v = 2', 'Main v2')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Get the original commit SHA before attempting rebase
    const originalSha = gitRepo.git('rev-parse feature/cancel-test')

    // Drag and then cancel
    await dragBranchOntoCommit(page, 'feature/cancel-test', 'Main v2')
    await waitForRebasePrompt(page)
    await page.getByTestId('cancel-rebase-button').click()

    // Prompt should disappear
    await waitForRebasePromptDismissed(page)

    // Branch SHA should be unchanged (rebase was canceled)
    const afterSha = gitRepo.git('rev-parse feature/cancel-test')
    expect(afterSha).toBe(originalSha)
  })

  testWithRepo('rebased branch shows in correct position in stack', async ({
    page,
    gitRepo
  }) => {
    // Create a stack: main -> feature-a, then a sibling feature-b
    gitRepo.createBranch('feature-a')
    gitRepo.commitFile('src/a.ts', 'a', 'Feature A')

    gitRepo.checkout('main')
    gitRepo.createBranch('feature-b')
    gitRepo.commitFile('src/b.ts', 'b', 'Feature B')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await expectBranchVisible(page, 'feature-a')
    await expectBranchVisible(page, 'feature-b')

    // Rebase feature-b onto feature-a (making it a stacked branch)
    await dragBranchOnto(page, 'feature-b', 'feature-a')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Both branches should still be visible
    await expectBranchVisible(page, 'feature-a')
    await expectBranchVisible(page, 'feature-b')

    // Verify via git that feature-b is now on top of feature-a
    const log = gitRepo.git('log --oneline feature-b')
    expect(log).toContain('Feature A')
    expect(log).toContain('Feature B')
  })

  testWithRepo('rebase with multiple commits on feature branch preserves all', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/multi-commit')
    gitRepo.commitFile('src/a.ts', 'a', 'First feature commit')
    gitRepo.commitFile('src/b.ts', 'b', 'Second feature commit')
    gitRepo.commitFile('src/c.ts', 'c', 'Third feature commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main advance')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/multi-commit', 'Main advance')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // All three commits should still exist on the branch
    const log = gitRepo.git('log --oneline feature/multi-commit')
    expect(log).toContain('First feature commit')
    expect(log).toContain('Second feature commit')
    expect(log).toContain('Third feature commit')
    expect(log).toContain('Main advance')
  })

  testWithRepo('rebase onto same parent is a no-op', async ({ page, gitRepo }) => {
    // Create a branch that's already on top of the latest main commit
    gitRepo.commitFile('src/base.ts', 'base', 'Base commit')
    gitRepo.createBranch('feature/already-on-top')
    gitRepo.commitFile('src/feat.ts', 'feat', 'Feature on top')

    const originalSha = gitRepo.git('rev-parse feature/already-on-top')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Try to drag onto the commit it's already based on
    await dragBranchOntoCommit(page, 'feature/already-on-top', 'Base commit')

    // Either no prompt appears (the drag is rejected because it's the original parent)
    // or if it does appear, the rebase should be a no-op
    await page.waitForTimeout(2000)

    // SHA should be unchanged
    const afterSha = gitRepo.git('rev-parse feature/already-on-top')
    expect(afterSha).toBe(originalSha)
  })
})

testWithRepo.describe('Rebase with File Changes', () => {
  testWithRepo('rebase correctly moves non-conflicting file changes', async ({
    page,
    gitRepo
  }) => {
    // Feature branch modifies file A, main modifies file B — no conflict
    gitRepo.createBranch('feature/file-changes')
    gitRepo.commitFile('src/feature-file.ts', 'feature content', 'Add feature file')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main-file.ts', 'main content', 'Add main file')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/file-changes', 'Add main file')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Verify both files exist on the rebased branch
    const files = gitRepo.git('ls-tree --name-only -r feature/file-changes')
    expect(files).toContain('src/feature-file.ts')
    expect(files).toContain('src/main-file.ts')
  })

  testWithRepo('rebase preserves commit authorship', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/authorship')
    gitRepo.commitFile('src/auth.ts', 'authored code', 'Authored commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/authorship', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Verify author is preserved
    const author = gitRepo.git('log -1 --format="%an" feature/authorship')
    expect(author).toBe('Test User')
  })
})
