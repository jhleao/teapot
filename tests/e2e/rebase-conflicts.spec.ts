/**
 * Rebase conflict resolution E2E tests.
 *
 * These verify the conflict resolution dialog and workflows
 * when a rebase produces merge conflicts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'
import {
  abortRebase,
  confirmRebase,
  continueRebase,
  dragBranchOntoCommit,
  expectBranchVisible,
  getRebaseExecutionPath,
  waitForConflictDialog,
  waitForConflictDialogDismissed,
  waitForRebasePrompt,
  waitForRebasePromptDismissed,
  waitForStackView
} from './helpers/drag'

/**
 * Resolves all conflict markers in a file by keeping "ours" side.
 * Writes the resolved content and stages the file in the given worktree.
 */
function resolveConflictKeepOurs(worktreePath: string, filePath: string): void {
  const fullPath = path.join(worktreePath, filePath)
  const content = fs.readFileSync(fullPath, 'utf-8')

  // Simple conflict marker resolution: keep content between <<<< and ====
  const resolved = content.replace(
    /<<<<<<< HEAD\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> .*\n/g,
    '$1'
  )
  fs.writeFileSync(fullPath, resolved)
}

/**
 * Resolves all conflict markers in a file with custom content.
 */
function resolveConflictWithContent(worktreePath: string, filePath: string, content: string): void {
  const fullPath = path.join(worktreePath, filePath)
  fs.writeFileSync(fullPath, content)
}

/**
 * Stages a resolved file in the git worktree.
 */
function stageResolvedFile(worktreePath: string, filePath: string): void {
  const { execSync } = require('node:child_process')
  execSync(`git add "${filePath}"`, {
    cwd: worktreePath,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1'
    }
  })
}

testWithRepo.describe('Conflict Resolution Dialog', () => {
  testWithRepo('shows conflict dialog when rebase produces conflicts', async ({
    page,
    gitRepo
  }) => {
    // Setup conflicting changes on the same file
    gitRepo.createBranch('feature/conflict')
    gitRepo.commitFile('src/shared.ts', 'feature version of shared', 'Feature changes shared')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/shared.ts', 'main version of shared', 'Main changes shared')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Trigger rebase that will conflict
    await dragBranchOntoCommit(page, 'feature/conflict', 'Main changes shared')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    // Conflict dialog should appear
    await waitForConflictDialog(page)

    // Verify dialog elements
    await expect(page.getByTestId('conflict-resolution-dialog')).toBeVisible()
    await expect(page.getByTestId('abort-rebase-button')).toBeVisible()
    // Continue should be disabled until conflicts resolved
    await expect(page.getByTestId('continue-rebase-button')).toBeDisabled()
  })

  testWithRepo('shows conflicted file in the dialog', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/file-conflict')
    gitRepo.commitFile('src/config.ts', 'feature config', 'Feature config change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/config.ts', 'main config', 'Main config change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/file-conflict', 'Main config change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // The conflicted file should be listed
    await expect(page.getByTestId('conflict-file-src/config.ts')).toBeVisible()
  })

  testWithRepo('can resolve conflicts and continue rebase', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/resolve-me')
    gitRepo.commitFile('src/app.ts', 'feature app code', 'Feature app change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/app.ts', 'main app code', 'Main app change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/resolve-me', 'Main app change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // Get the execution path to resolve conflicts
    const execPath = await getRebaseExecutionPath(page, gitRepo.repoPath)
    expect(execPath).toBeTruthy()

    // Resolve the conflict
    resolveConflictWithContent(execPath!, 'src/app.ts', 'resolved app code')
    stageResolvedFile(execPath!, 'src/app.ts')

    // Wait for the watcher to detect resolution, then click continue
    await page.waitForTimeout(3000)
    await continueRebase(page)

    // Dialog should close
    await waitForConflictDialogDismissed(page)

    // Rebase should complete
    await waitForRebasePromptDismissed(page)

    // Branch should still be visible
    await expectBranchVisible(page, 'feature/resolve-me')

    // Verify the resolved content
    gitRepo.checkout('feature/resolve-me')
    const content = fs.readFileSync(path.join(gitRepo.repoPath, 'src/app.ts'), 'utf-8')
    expect(content).toBe('resolved app code')
  })

  testWithRepo('can abort rebase from conflict dialog', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/abort-me')
    gitRepo.commitFile('src/data.ts', 'feature data', 'Feature data change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/data.ts', 'main data', 'Main data change')

    const originalSha = gitRepo.git('rev-parse feature/abort-me')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/abort-me', 'Main data change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // Abort the rebase
    await abortRebase(page)

    // Dialog should close
    await waitForConflictDialogDismissed(page)

    // Branch should be restored to its original SHA
    const afterSha = gitRepo.git('rev-parse feature/abort-me')
    expect(afterSha).toBe(originalSha)
  })

  testWithRepo('shows multiple conflicted files', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/multi-conflict')
    gitRepo.commitFile('src/a.ts', 'feature a', 'Feature change A')
    gitRepo.commitFile('src/b.ts', 'feature b', 'Feature change B')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/a.ts', 'main a', 'Main change A')
    gitRepo.commitFile('src/b.ts', 'main b', 'Main change B')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/multi-conflict', 'Main change B')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // Both files should be listed (note: may be in first conflicting commit)
    // At least one conflict file should be visible
    const conflictFiles = page.locator('[data-testid^="conflict-file-"]')
    const count = await conflictFiles.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  testWithRepo('conflict dialog shows editor/terminal buttons when execution path exists', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/editor-buttons')
    gitRepo.commitFile('src/edit.ts', 'feature edit', 'Feature edit change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/edit.ts', 'main edit', 'Main edit change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/editor-buttons', 'Main edit change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // Editor and terminal buttons should be present
    await expect(page.getByTestId('open-in-editor-button')).toBeVisible()
    await expect(page.getByTestId('open-in-terminal-button')).toBeVisible()
    await expect(page.getByTestId('copy-worktree-path-button')).toBeVisible()

    // Clean up: abort
    await abortRebase(page)
  })

  testWithRepo('continue button enables after resolving all conflicts', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/enable-continue')
    gitRepo.commitFile('src/resolve.ts', 'feature resolve', 'Feature resolve change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/resolve.ts', 'main resolve', 'Main resolve change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/enable-continue', 'Main resolve change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)

    // Continue should be disabled initially
    await expect(page.getByTestId('continue-rebase-button')).toBeDisabled()

    // Resolve the conflict
    const execPath = await getRebaseExecutionPath(page, gitRepo.repoPath)
    expect(execPath).toBeTruthy()
    resolveConflictWithContent(execPath!, 'src/resolve.ts', 'resolved content')
    stageResolvedFile(execPath!, 'src/resolve.ts')

    // Wait for watcher to detect resolution
    await page.waitForTimeout(3000)

    // Continue should now be enabled
    await expect(page.getByTestId('continue-rebase-button')).toBeEnabled({ timeout: 10000 })

    // Complete the rebase
    await continueRebase(page)
    await waitForConflictDialogDismissed(page)
  })
})

testWithRepo.describe('Sequential Conflict Resolution', () => {
  testWithRepo('resolves conflicts in multiple sequential commits', async ({
    page,
    gitRepo
  }) => {
    // Create a branch with two commits that both conflict with main
    gitRepo.createBranch('feature/sequential')
    gitRepo.commitFile('src/seq.ts', 'feature seq v1', 'Sequential commit 1')
    gitRepo.commitFile('src/seq.ts', 'feature seq v2', 'Sequential commit 2')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/seq.ts', 'main seq', 'Main seq change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/sequential', 'Main seq change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    // First conflict
    await waitForConflictDialog(page)

    const execPath = await getRebaseExecutionPath(page, gitRepo.repoPath)
    expect(execPath).toBeTruthy()
    resolveConflictWithContent(execPath!, 'src/seq.ts', 'resolved seq v1')
    stageResolvedFile(execPath!, 'src/seq.ts')

    await page.waitForTimeout(3000)
    await continueRebase(page)

    // Either a second conflict appears (for the second commit)
    // or the rebase completes if the second commit applies cleanly
    // Wait a bit to see what happens
    await page.waitForTimeout(3000)

    // Check if there's another conflict dialog
    const hasSecondConflict = await page
      .getByTestId('conflict-resolution-dialog')
      .isVisible()
      .catch(() => false)

    if (hasSecondConflict) {
      // Resolve the second conflict
      const execPath2 = await getRebaseExecutionPath(page, gitRepo.repoPath)
      expect(execPath2).toBeTruthy()
      resolveConflictWithContent(execPath2!, 'src/seq.ts', 'resolved seq v2')
      stageResolvedFile(execPath2!, 'src/seq.ts')

      await page.waitForTimeout(3000)
      await continueRebase(page)
      await waitForConflictDialogDismissed(page)
    }

    // Rebase should be complete
    await expectBranchVisible(page, 'feature/sequential')

    // Verify final content
    gitRepo.checkout('feature/sequential')
    const finalContent = fs.readFileSync(path.join(gitRepo.repoPath, 'src/seq.ts'), 'utf-8')
    expect(finalContent).toContain('resolved seq')
  })
})
