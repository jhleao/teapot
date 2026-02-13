import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('Squash Dialog - Empty Result', () => {
  testWithRepo(
    'shows remove dialog and deletes both branches when result would be empty',
    async ({ page, gitRepo }) => {
      // Stack: main -> parent (modifies file) -> target (reverts file to initial)
      gitRepo.commitFile('file.txt', 'initial content', 'add file')
      gitRepo.createBranch('parent')
      gitRepo.commitFile('file.txt', 'parent content', 'parent commit')
      gitRepo.createBranch('target')
      gitRepo.commitFile('file.txt', 'initial content', 'revert parent changes')
      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

      await expect(page.getByTestId('branch-badge-target')).toBeVisible({ timeout: 5000 })
      await expect(page.getByTestId('branch-badge-parent')).toBeVisible({ timeout: 5000 })

      // Right-click on target branch badge
      await page.getByTestId('branch-badge-target').click({ button: 'right' })
      await page.getByText('Squash into parent').click()

      // Dialog should show "Remove" title instead of "Squash"
      await expect(page.getByText('Remove target and parent')).toBeVisible({ timeout: 10000 })

      // Warning message should be visible
      await expect(page.getByText('Changes cancel out')).toBeVisible()
      await expect(page.getByText('Both branches will be removed')).toBeVisible()

      // Textarea should NOT be visible (no commit message needed)
      await expect(page.locator('textarea')).not.toBeVisible()

      // Button should say "Remove Branches" not "Squash"
      const removeButton = page.getByRole('button', { name: 'Remove Branches' })
      await expect(removeButton).toBeVisible()
      await expect(removeButton).toBeEnabled()

      // Should NOT have a "Squash" button
      await expect(page.getByRole('button', { name: 'Squash' })).not.toBeVisible()

      // Click remove
      await removeButton.click()

      // Wait for dialog to close and both branches to disappear
      await expect(page.getByText('Remove target and parent')).not.toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('branch-badge-target')).not.toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('branch-badge-parent')).not.toBeVisible({ timeout: 10000 })
    }
  )

  testWithRepo(
    'rebases descendants when removing empty result mid-stack',
    async ({ page, gitRepo }) => {
      // Stack: main -> parent (modifies file) -> target (reverts file) -> child (adds new file)
      gitRepo.commitFile('file.txt', 'initial content', 'add file')
      gitRepo.createBranch('parent')
      gitRepo.commitFile('file.txt', 'parent content', 'parent commit')
      gitRepo.createBranch('target')
      gitRepo.commitFile('file.txt', 'initial content', 'revert parent changes')
      gitRepo.createBranch('child')
      gitRepo.commitFile('child.txt', 'child content', 'child commit')
      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

      await expect(page.getByTestId('branch-badge-target')).toBeVisible({ timeout: 5000 })
      await expect(page.getByTestId('branch-badge-child')).toBeVisible({ timeout: 5000 })

      // Right-click on target branch badge
      await page.getByTestId('branch-badge-target').click({ button: 'right' })
      await page.getByText('Squash into parent').click()

      // Dialog should show remove UI
      await expect(page.getByText('Remove target and parent')).toBeVisible({ timeout: 10000 })

      // Descendants info should show the child branch will be rebased
      const rebaseInfo = page.getByText('Will rebase').locator('..')
      await expect(rebaseInfo).toBeVisible()
      await expect(rebaseInfo.getByText('child')).toBeVisible()

      // Click remove
      await page.getByRole('button', { name: 'Remove Branches' }).click()

      // Wait for dialog to close
      await expect(page.getByText('Remove target and parent')).not.toBeVisible({ timeout: 15000 })

      // Parent and target should be gone
      await expect(page.getByTestId('branch-badge-target')).not.toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('branch-badge-parent')).not.toBeVisible({ timeout: 10000 })

      // Child should still exist — it was rebased onto main
      await expect(page.getByTestId('branch-badge-child')).toBeVisible()
    }
  )

  testWithRepo(
    'can cancel remove dialog without side effects',
    async ({ page, gitRepo }) => {
      // Stack: main -> parent (modifies file) -> target (reverts file)
      gitRepo.commitFile('file.txt', 'initial content', 'add file')
      gitRepo.createBranch('parent')
      gitRepo.commitFile('file.txt', 'parent content', 'parent commit')
      gitRepo.createBranch('target')
      gitRepo.commitFile('file.txt', 'initial content', 'revert parent changes')
      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('branch-badge-target')).toBeVisible({ timeout: 5000 })

      // Open dialog
      await page.getByTestId('branch-badge-target').click({ button: 'right' })
      await page.getByText('Squash into parent').click()
      await expect(page.getByText('Remove target and parent')).toBeVisible({ timeout: 10000 })

      // Click Cancel
      await page.getByRole('button', { name: 'Cancel' }).click()

      // Dialog should close
      await expect(page.getByText('Remove target and parent')).not.toBeVisible()

      // Both branches should still exist
      await expect(page.getByTestId('branch-badge-target')).toBeVisible()
      await expect(page.getByTestId('branch-badge-parent')).toBeVisible()
    }
  )
})
