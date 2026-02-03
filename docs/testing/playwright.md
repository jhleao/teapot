# Playwright E2E Testing for Teapot

This document covers Teapot's end-to-end testing infrastructure using Playwright with Electron.

## Prerequisites

1. **Build the app first** - Tests run against the compiled output:

   ```bash
   pnpm build
   ```

2. **Install Playwright browsers** (if not already installed):

   ```bash
   npx playwright install
   ```

3. **Optional:** Set `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` to share browser downloads across worktrees.

## Running Tests

### Local E2E

```bash
# Run all tests
pnpm e2e

# Open test report
pnpm e2e:trace:open

# Clean artifacts and temp profiles
pnpm e2e:clean
```

Test artifacts are saved to `.context/playwright/` (gitignored):

- `artifacts/` - Screenshots, videos, traces on failure
- `html-report/` - Interactive HTML report

### Viewing Failed Test Traces

When tests fail, Playwright saves detailed traces. View them with:

```bash
pnpm exec playwright show-trace .context/playwright/artifacts/<test-folder>/trace.zip
```

## CI Integration

E2E tests run automatically on PRs via GitHub Actions. The workflow uses `xvfb-run` to provide a virtual display for Electron on Linux runners.

```yaml
# .github/workflows/checks.yml
e2e:
  runs-on: ubuntu-latest
  steps:
    - run: pnpm build
    - run: xvfb-run --auto-servernum -- pnpm e2e
```

On failure, test artifacts (traces, screenshots, videos) are uploaded and accessible from the Actions tab.

## Test Structure

```
tests/e2e/
├── fixtures/
│   ├── electronApp.ts    # Electron app fixture (app, page)
│   ├── gitRepo.ts        # Git repository fixture for testing
│   └── testWithRepo.ts   # Composite fixture (app + git repo)
├── smoke.spec.ts         # Basic app functionality (3 tests)
├── settings.spec.ts      # Settings dialog (4 tests)
├── repo-selection.spec.ts # Repository selection UI (4 tests)
├── repo-workflow.spec.ts  # Repository loading workflow (5 tests)
├── ui-elements.spec.ts    # UI element verification (7 tests)
├── keyboard-navigation.spec.ts # Keyboard accessibility (8 tests)
├── error-states.spec.ts   # Error handling (9 tests)
├── edge-cases.spec.ts     # Edge case handling (12 tests)
├── branch-naming.spec.ts  # Branch name edge cases (14 tests)
├── complex-repos.spec.ts  # Complex repo structures (8 tests)
└── large-repos.spec.ts    # Performance with large repos (13 tests)
```

### Fixtures

#### electronApp

Provides `{ app, page }` for each test:

- `app` - The Electron application instance
- `page` - The first window's page object

Each test gets an isolated userData directory to prevent test pollution.

#### testWithRepo (Recommended)

Combines Electron app and git repo fixtures. Use this for most tests:

```typescript
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo('loads commits', async ({ page, gitRepo }) => {
  await expect(page.getByTestId('app-container')).toBeVisible()

  // Create test data
  gitRepo.commitFile('feature.ts', 'export const x = 1', 'Add feature')

  // Load repo into app
  await addRepoToApp(page, gitRepo.repoPath)

  // Verify UI
  await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Add feature')).toBeVisible()
})
```

**gitRepo helpers:**
- `gitRepo.repoPath` - Path to temp git repo
- `gitRepo.git('command')` - Run any git command
- `gitRepo.commitFile(path, content, message)` - Create a commit
- `gitRepo.createFile(path, content)` - Create file without committing
- `gitRepo.createBranch(name)` - Create and checkout branch
- `gitRepo.checkout(ref)` - Checkout branch or commit

## Test Selectors

We use `data-testid` attributes for reliable test selectors. Key test IDs:

| Component            | Test ID                      |
| -------------------- | ---------------------------- |
| App container        | `app-container`              |
| Topbar               | `topbar`                     |
| Settings button      | `settings-button`            |
| Settings dialog      | `settings-dialog`            |
| Repo selector        | `repo-selector`              |
| Repo selector button | `repo-selector-button`       |
| Repo dropdown        | `repo-dropdown`              |
| Add repo button      | `add-repo-button`            |
| Clone repo button    | `clone-repo-button`          |
| Stack view           | `stack-view`                 |
| Sync button          | `sync-button`                |
| Empty state (no repo)| `empty-state-no-repo`        |
| Empty state (error)  | `empty-state-error`          |
| Empty state action   | `empty-state-action`         |
| Error reload button  | `error-reload-button`        |
| No repo message      | `no-repo-message`            |
| Repo metadata        | `repo-metadata-container`    |
| Commit item          | `commit-item`                |
| Commit timestamp     | `commit-timestamp`           |
| Branch badge         | `branch-badge-{branch-name}` |

### Using Test IDs

```typescript
await page.getByTestId('settings-button').click()
await expect(page.getByTestId('settings-dialog')).toBeVisible()
```

Prefer `getByTestId()` for app-specific elements, `getByRole()` for standard UI patterns.

## Agent-Driven UI Development

Agents can interact with the Electron app in headless mode for UI development feedback loops.

### E2E Driver Script

The `e2e:drive` script lets agents drive the app and inspect UI state:

```bash
# Build the app first
pnpm build

# Single command mode (run and exit)
pnpm e2e:drive screenshot /tmp/ui.png
pnpm e2e:drive snapshot              # Get accessibility tree
pnpm e2e:drive click settings-button
pnpm e2e:drive wait settings-dialog
pnpm e2e:drive press Escape

# Interactive mode (REPL)
pnpm e2e:drive interactive
teapot> screenshot
teapot> click repo-selector-button
teapot> snapshot
teapot> quit
```

**Commands:**

| Command | Args | Description |
|---------|------|-------------|
| `screenshot` | `[path]` | Save screenshot (default: `/tmp/teapot-screenshot.png`) |
| `snapshot` | | Get accessibility tree JSON |
| `click` | `<testid>` | Click element by data-testid |
| `type` | `<testid> <text>` | Type text into element |
| `press` | `<key>` | Press keyboard key (Enter, Escape, Tab) |
| `wait` | `<testid>` | Wait for element to be visible |
| `eval` | `<script>` | Evaluate JS in renderer |
| `html` | | Get full page HTML |

### Agent Workflow Example

For UI development with feedback loop:

```
1. Agent makes code changes to component
2. Run `pnpm build` to rebuild
3. Use driver to verify:
   - `pnpm e2e:drive screenshot /tmp/before.png`
   - `pnpm e2e:drive click <element>`
   - `pnpm e2e:drive snapshot` to check state
   - `pnpm e2e:drive screenshot /tmp/after.png`
4. Compare screenshots, analyze accessibility tree
5. Iterate on code changes
```

### Complete Example: Adding a "New Branch" Button

**Feature Request:** "Add a button to the topbar that opens a dialog to create a new branch"

#### Step 1: Explore Current UI State

```bash
# Build and capture current state
pnpm build
pnpm e2e:drive screenshot /tmp/01-before.png
pnpm e2e:drive snapshot > /tmp/01-accessibility.json
```

Agent analyzes the screenshot and accessibility tree to understand:
- Where the topbar is located
- Existing button patterns (settings-button, sync-button)
- Current layout and spacing

#### Step 2: Implement the Button

Agent edits `src/web/components/Topbar.tsx`:

```tsx
// Add new button next to existing buttons
<button
  data-testid="new-branch-button"
  onClick={() => setShowNewBranchDialog(true)}
  className="..."
>
  <GitBranch className="h-4 w-4" />
  New Branch
</button>
```

#### Step 3: Build and Verify Button Appears

```bash
pnpm build
pnpm e2e:drive screenshot /tmp/02-button-added.png
pnpm e2e:drive snapshot | grep -A5 "new-branch"
```

Agent checks:
- ✅ Button visible in screenshot
- ✅ `new-branch-button` appears in accessibility tree
- ❌ Button styling doesn't match other buttons

#### Step 4: Fix Styling Issue

Agent adjusts the className to match existing button styles, rebuilds:

```bash
pnpm build
pnpm e2e:drive screenshot /tmp/03-button-styled.png
```

Agent confirms styling now matches.

#### Step 5: Implement the Dialog

Agent creates `src/web/components/NewBranchDialog.tsx` and wires it up.

```bash
pnpm build
pnpm e2e:drive click new-branch-button
pnpm e2e:drive screenshot /tmp/04-dialog-open.png
pnpm e2e:drive snapshot | grep -A10 "dialog"
```

Agent checks:
- ✅ Dialog opens on click
- ✅ Dialog has input field for branch name
- ❌ Dialog missing cancel button

#### Step 6: Add Cancel Button and Test Keyboard

```bash
pnpm build
pnpm e2e:drive click new-branch-button
pnpm e2e:drive wait new-branch-dialog
pnpm e2e:drive press Escape
pnpm e2e:drive snapshot | grep "new-branch-dialog"
```

Agent verifies:
- ✅ Escape closes the dialog
- ✅ Cancel button visible
- ✅ Dialog no longer in accessibility tree after close

#### Step 7: Test the Full Flow

```bash
pnpm e2e:drive click new-branch-button
pnpm e2e:drive type branch-name-input feature/my-new-branch
pnpm e2e:drive screenshot /tmp/05-form-filled.png
pnpm e2e:drive click create-branch-button
pnpm e2e:drive wait branch-badge-feature/my-new-branch
pnpm e2e:drive screenshot /tmp/06-branch-created.png
```

Agent confirms:
- ✅ Branch name input works
- ✅ Create button triggers branch creation
- ✅ New branch badge appears in stack view

#### Step 8: Write E2E Test

Now that the feature works, agent writes a test in `tests/e2e/new-branch.spec.ts`:

```typescript
testWithRepo('can create new branch from dialog', async ({ page, gitRepo }) => {
  await addRepoToApp(page, gitRepo.repoPath)
  await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

  // Open dialog
  await page.getByTestId('new-branch-button').click()
  await expect(page.getByTestId('new-branch-dialog')).toBeVisible()

  // Fill form
  await page.getByTestId('branch-name-input').fill('feature/test-branch')
  await page.getByTestId('create-branch-button').click()

  // Verify branch created
  await expect(page.getByTestId('branch-badge-feature/test-branch')).toBeVisible()
})
```

#### Step 9: Run Full E2E Suite

```bash
pnpm e2e
```

Agent verifies all tests pass, including the new test.

#### Summary of Commands Used

| Phase | Commands |
|-------|----------|
| Explore | `screenshot`, `snapshot` |
| Verify UI | `screenshot`, `snapshot \| grep` |
| Test interactions | `click`, `type`, `press`, `wait` |
| Debug | `html`, `eval` |

This feedback loop lets agents iterate rapidly without manual intervention, catching issues like missing elements, styling problems, or broken interactions before writing formal tests.

### Playwright MCP Server (Web Apps)

For standard web apps (not Electron), use the MCP server:

```bash
npx playwright run-test-mcp-server
```

This exposes tools like `browser_click`, `browser_snapshot`, `generator_write_test`.

### Agent Definitions

Pre-configured agents in `.claude/agents/`:

| Agent | Purpose |
|-------|---------|
| `playwright-test-planner` | Create test plans from requirements |
| `playwright-test-generator` | Generate tests by driving the browser |
| `playwright-test-healer` | Fix broken tests using traces |

## Environment Variables

| Variable                   | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| `TEAPOT_E2E=1`             | Enables E2E mode (disables updater, enables test isolation) |
| `TEAPOT_E2E_USER_DATA`     | Custom userData path for test isolation                     |
| `PLAYWRIGHT_BROWSERS_PATH` | Shared browser download location                            |
| `PLAYWRIGHT_WS_PORT`       | WebSocket server port for remote driving                    |

## Writing New Tests

1. **Create test file** in `tests/e2e/`
2. **Import the fixture:**
   ```typescript
   import { test, expect } from './fixtures/electronApp'
   ```
3. **Use test IDs** for element selection:
   ```typescript
   test('example', async ({ page }) => {
     await page.getByTestId('settings-button').click()
     await expect(page.getByTestId('settings-dialog')).toBeVisible()
   })
   ```
4. **Add test IDs** to components if needed:
   ```tsx
   <button data-testid="my-button">Click me</button>
   ```

## Troubleshooting

### Tests failing with "Build artifacts missing"

Run `pnpm build` before `pnpm e2e`.

### Tests timing out

- Increase timeout in `playwright.electron.config.ts`
- Check if app is launching correctly
- Review test traces for what's happening

### Flaky tests

- Use `await expect(...).toBeVisible()` before interactions
- Avoid relying on timing - use explicit waits
- Run with `--workers=1` to serialize tests

### Store/config pollution between tests

The fixture creates isolated userData directories. If pollution occurs, check that `configStore` lazy initialization is working correctly.
