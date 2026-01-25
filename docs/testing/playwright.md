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

## Test Structure

```
tests/e2e/
├── fixtures/
│   ├── electronApp.ts    # Electron app fixture (app, page)
│   └── gitRepo.ts        # Git repository fixture for testing
├── smoke.spec.ts         # Basic app functionality tests
├── repo-selection.spec.ts # Repository selection UI tests
└── settings.spec.ts      # Settings dialog tests
```

### Fixtures

#### electronApp

Provides `{ app, page }` for each test:
- `app` - The Electron application instance
- `page` - The first window's page object

Each test gets an isolated userData directory to prevent test pollution.

#### gitRepo (Optional)

Provides an isolated git repository for tests that need git data:

```typescript
import { testWithGitRepo } from './fixtures/gitRepo'

testWithGitRepo('loads commits', async ({ page, gitRepo }) => {
  // gitRepo.repoPath - path to temp git repo
  // gitRepo.git('status') - run git commands
  // gitRepo.commitFile('file.ts', 'content', 'message') - create commits
})
```

## Test Selectors

We use `data-testid` attributes for reliable test selectors. Key test IDs:

| Component | Test ID |
|-----------|---------|
| App container | `app-container` |
| Settings button | `settings-button` |
| Settings dialog | `settings-dialog` |
| Topbar | `topbar` |
| Empty state | `empty-state-{variant}` |
| Repo selector | `repo-selector` |
| Stack view | `stack-view` |
| Sync button | `sync-button` |

### Using Test IDs

```typescript
await page.getByTestId('settings-button').click()
await expect(page.getByTestId('settings-dialog')).toBeVisible()
```

Prefer `getByTestId()` for app-specific elements, `getByRole()` for standard UI patterns.

## Agent-Driven Testing

### Playwright MCP Server

Agents can drive tests via Playwright's MCP (Model Context Protocol) server:

```bash
# Start the MCP server
npx playwright run-test-mcp-server
```

This exposes tools like:
- `browser_navigate`, `browser_click`, `browser_type`
- `browser_snapshot` - get accessibility tree
- `generator_setup_page`, `generator_write_test`

### WebSocket Server (Remote Driving)

For multi-worktree or remote scenarios:

```bash
# Start WebSocket server
PLAYWRIGHT_WS_PORT=9339 pnpm e2e:serve
```

Connect from another process:
```typescript
const pw = require('@playwright/test')
const browser = await pw.chromium.connect({ wsEndpoint: 'ws://localhost:9339' })
```

### Generated Agent Infrastructure

Initialize agent tooling with:

```bash
npx playwright init-agents --loop claude --prompts
```

This creates:
- `.claude/agents/` - Agent definitions for test generation/healing
- `.claude/prompts/` - Prompt templates
- `.mcp.json` - MCP server configuration
- `specs/README.md` - Directory for test plans

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEAPOT_E2E=1` | Enables E2E mode (disables updater, enables test isolation) |
| `TEAPOT_E2E_USER_DATA` | Custom userData path for test isolation |
| `PLAYWRIGHT_BROWSERS_PATH` | Shared browser download location |
| `PLAYWRIGHT_WS_PORT` | WebSocket server port for remote driving |

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
