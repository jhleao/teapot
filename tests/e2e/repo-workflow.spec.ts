import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('Repository Workflow', () => {
  testWithRepo('can add a git repository and see it loaded', async ({ page, gitRepo }) => {
    // Verify app container is present
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Initially should show empty state
    await expect(page.getByTestId('empty-state-no-repo')).toBeVisible()

    // Add the test repo via IPC and reload
    await addRepoToApp(page, gitRepo.repoPath)

    // After reload, the stack-view should appear with the repo loaded
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Sync button should be visible (indicates trunk is loaded)
    await expect(page.getByTestId('sync-button')).toBeVisible()
  })

  testWithRepo('loaded repo shows repository name in topbar', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Add the test repo
    await addRepoToApp(page, gitRepo.repoPath)

    // Wait for repo to load
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Repo metadata container should be visible
    await expect(page.getByTestId('repo-metadata-container')).toBeVisible()

    // The "No repository selected" message should not be visible
    await expect(page.getByTestId('no-repo-message')).not.toBeVisible()
  })

  testWithRepo('can see Initial commit in stack view', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Add the repo (it already has an Initial commit from fixture setup)
    await addRepoToApp(page, gitRepo.repoPath)

    // Wait for stack view
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Should see the Initial commit from the fixture
    await expect(page.getByText('Initial commit')).toBeVisible()
  })
})

testWithRepo.describe('Repository with Branches', () => {
  testWithRepo('shows feature branch in stack view', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create a feature branch with commits
    gitRepo.createBranch('feature/login')
    gitRepo.commitFile('src/login.ts', 'export function login() {}', 'Add login feature')

    // Add the repo
    await addRepoToApp(page, gitRepo.repoPath)

    // Wait for stack view (use .first() as multiple branches = multiple stack-views)
    await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

    // Should see the branch badge with the branch name
    await expect(page.getByTestId('branch-badge-feature/login')).toBeVisible({ timeout: 5000 })
  })

  testWithRepo('shows stacked branches correctly', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create stacked branches: main -> feature/auth -> feature/auth-ui
    gitRepo.createBranch('feature/auth')
    gitRepo.commitFile('src/auth.ts', 'export function authenticate() {}', 'Add auth module')

    gitRepo.createBranch('feature/auth-ui')
    gitRepo.commitFile('src/auth-ui.tsx', '<button>Login</button>', 'Add auth UI')

    // Add the repo
    await addRepoToApp(page, gitRepo.repoPath)

    // Wait for stack view (use .first() as multiple branches = multiple stack-views)
    await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

    // Both branches should be visible via their branch badges
    await expect(page.getByTestId('branch-badge-feature/auth-ui')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('branch-badge-feature/auth')).toBeVisible({ timeout: 5000 })
  })
})
