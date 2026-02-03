# Feature Specification: E2E Testing Infrastructure

## Overview

A comprehensive end-to-end testing infrastructure for Teapot using Playwright with Electron. The system enables both automated test execution in CI and AI-agent-assisted test development through an MCP (Model Context Protocol) server and custom driver scripts.

---

## Problem Statement

### User Pain Points

1. **No Automated UI Testing**: Without E2E tests, UI regressions go undetected until users report them. Manual testing is slow and incomplete.

2. **Electron Testing Complexity**: Standard web testing tools don't work with Electron apps. The main process, renderer process, and IPC communication require specialized tooling.

3. **Test Data Isolation**: Git operations modify filesystem state. Tests that share repositories pollute each other, causing flaky failures.

4. **AI Agent Blindness**: AI coding assistants cannot see UI changes they make. Without visual feedback, agents iterate slowly and make mistakes.

5. **CI Environment Differences**: Electron apps require display servers. Linux CI runners fail without proper configuration (Xvfb, sandbox settings).

---

## Solution

A multi-layered testing infrastructure that provides:
- Playwright Electron integration with composable test fixtures
- Isolated git repositories per test via temporary directories
- Visual and programmatic feedback for AI agents via driver scripts
- CI-compatible configuration with artifact collection on failure

---

## Feature Requirements

### FR-1: Playwright Electron Configuration

Playwright must be configured to launch and control the Electron application.

**Acceptance Criteria:**
- Configuration file at `playwright.electron.config.ts`
- Tests run against compiled output (`out/main/index.js`)
- Build artifact validation before test execution
- Test timeout of 30 seconds per test
- Retry count of 2 for flaky test resilience
- Trace collection on first retry for debugging

### FR-2: Electron App Fixture

A reusable fixture providing isolated Electron app instances for each test.

**Acceptance Criteria:**
- Each test receives fresh `app` (ElectronApplication) and `page` (Page) objects
- Isolated `userDataDir` created per test in temp directory
- User data directory cleaned up after test completion
- Environment variable `TEAPOT_E2E=1` set to enable test mode
- Environment variable `TEAPOT_E2E_USER_DATA` points to isolated directory
- Graceful app shutdown with 5-second timeout and forced kill fallback
- Sandbox disabled automatically when `CI` environment variable is set

### FR-3: Git Repository Fixture

A fixture that creates and manages temporary git repositories for testing.

**Acceptance Criteria:**
- Creates isolated git repository in temp directory per test
- Initial commit with README created automatically
- Repository cleaned up after test completion
- Helper methods available:
  - `repoPath`: Absolute path to repository
  - `git(command)`: Execute arbitrary git commands
  - `commitFile(path, content, message)`: Create file and commit
  - `createFile(path, content)`: Create file without committing
  - `createBranch(name)`: Create and checkout new branch
  - `checkout(ref)`: Switch to branch or commit
- Git user configured (`Test User <test@example.com>`)

### FR-4: Composite Test Fixture

A combined fixture that provides both Electron app and git repository.

**Acceptance Criteria:**
- Imports as `testWithRepo` from fixtures
- Provides `{ page, gitRepo }` to test functions
- Helper function `addRepoToApp(page, repoPath)` to load repository into app
- Repository loading triggers file dialog bypass via IPC
- Stack view visibility confirms successful repository loading

### FR-5: Data-TestID Selectors

UI components must have data-testid attributes for reliable test selection.

**Acceptance Criteria:**
- All interactive elements have `data-testid` attributes
- Test IDs follow consistent naming convention (kebab-case)
- Dynamic test IDs use pattern `{component}-{identifier}` (e.g., `branch-badge-main`)
- Core test IDs documented and stable:

| Component | Test ID |
|-----------|---------|
| App container | `app-container` |
| Topbar | `topbar` |
| Settings button | `settings-button` |
| Settings dialog | `settings-dialog` |
| Repo selector | `repo-selector` |
| Repo selector button | `repo-selector-button` |
| Repo dropdown | `repo-dropdown` |
| Add repo button | `add-repo-button` |
| Clone repo button | `clone-repo-button` |
| Stack view | `stack-view` |
| Sync button | `sync-button` |
| Empty state (no repo) | `empty-state-no-repo` |
| Empty state (error) | `empty-state-error` |
| Error reload button | `error-reload-button` |
| Commit item | `commit-item` |
| Branch badge | `branch-badge-{name}` |

### FR-6: CI Integration

E2E tests must run automatically in GitHub Actions.

**Acceptance Criteria:**
- Workflow defined in `.github/workflows/checks.yml`
- Tests run on `ubuntu-latest` runner
- Virtual display provided via `xvfb-run --auto-servernum`
- Build step (`pnpm build`) precedes test execution
- Test artifacts (traces, screenshots, videos) uploaded on failure
- Artifacts accessible from GitHub Actions UI

### FR-7: Test Artifact Collection

Failed tests must produce debugging artifacts.

**Acceptance Criteria:**
- Artifacts saved to `.context/playwright/` (gitignored)
- Subdirectories:
  - `artifacts/`: Screenshots, videos, traces on failure
  - `html-report/`: Interactive HTML report
- Traces viewable via `playwright show-trace` command
- HTML report viewable via `pnpm e2e:trace:open`
- Clean command (`pnpm e2e:clean`) removes all artifacts

### FR-8: E2E Driver Script

A command-line tool for AI agents to interact with the running application.

**Acceptance Criteria:**
- Script at `scripts/e2e-agent-driver.ts`
- Invoked via `pnpm e2e:drive <command> [args]`
- Single command mode: execute one command and exit
- Interactive mode: REPL for multiple commands
- Commands available:

| Command | Arguments | Description |
|---------|-----------|-------------|
| `screenshot` | `[path]` | Save screenshot (default: `/tmp/teapot-screenshot.png`) |
| `snapshot` | | Output accessibility tree as JSON |
| `click` | `<testid>` | Click element by data-testid |
| `type` | `<testid> <text>` | Type text into input element |
| `press` | `<key>` | Press keyboard key (Enter, Escape, Tab) |
| `wait` | `<testid>` | Wait for element to become visible |
| `eval` | `<script>` | Evaluate JavaScript in renderer process |
| `html` | | Output full page HTML |

### FR-9: MCP Server Configuration

Model Context Protocol server for AI-assisted test development.

**Acceptance Criteria:**
- Configuration file at `.mcp.json`
- Server command: `npx playwright run-test-mcp-server`
- Tools exposed to AI agents:
  - `browser_click`: Click elements
  - `browser_snapshot`: Get accessibility tree
  - `generator_write_test`: Generate test code
- Server available for standard web testing (not Electron-specific)

### FR-10: Agent Definition Files

Pre-configured AI agent prompts for test-related tasks.

**Acceptance Criteria:**
- Agents defined in `.claude/agents/` directory
- Agent files:
  - `playwright-test-planner.md`: Create test plans from requirements
  - `playwright-test-generator.md`: Generate tests by driving the app
  - `playwright-test-healer.md`: Fix broken tests using traces
- Companion prompts in `.claude/prompts/`:
  - `playwright-test-plan.md`
  - `playwright-test-generate.md`
  - `playwright-test-heal.md`
  - `playwright-test-coverage.md`

### FR-11: NPM Scripts

Package.json scripts for test execution and maintenance.

**Acceptance Criteria:**
- `pnpm e2e`: Run all E2E tests
- `pnpm e2e:trace:open`: Open HTML test report
- `pnpm e2e:clean`: Remove test artifacts and temp directories
- `pnpm e2e:drive`: Launch agent driver script

---

## Edge Cases

### EC-1: Build Artifacts Missing

**Scenario:** Tests run without prior `pnpm build`.

**Behavior:**
- Fixture validates `out/main/index.js` exists
- Clear error message: "Build artifacts missing. Run `pnpm build` before `pnpm e2e`."
- Test suite fails fast rather than timing out

### EC-2: App Close Timeout

**Scenario:** Electron app doesn't respond to close signal.

**Behavior:**
- Graceful close attempted first
- 5-second timeout triggers force kill via SIGKILL
- Process PID obtained from `electronApp.process().pid`
- Cleanup continues regardless of close method

### EC-3: CI Linux Sandbox

**Scenario:** Tests run on Linux CI runners that don't support SUID sandbox.

**Behavior:**
- `CI` environment variable detected
- `--no-sandbox` flag added to Electron launch args
- Tests execute without sandbox restrictions
- Security warning suppressed via `ELECTRON_DISABLE_SECURITY_WARNINGS`

### EC-4: Concurrent Test Pollution

**Scenario:** Multiple tests run in parallel accessing same resources.

**Behavior:**
- Each test gets unique temp directory via `fs.mkdtempSync`
- Directory naming pattern: `teapot-e2e-{random}`
- Git repositories fully isolated
- User data directories isolated per test
- Cleanup runs in test teardown

### EC-5: Repository Loading Timeout

**Scenario:** Repository takes longer than expected to load.

**Behavior:**
- Stack view visibility has 15-second timeout (configurable)
- Test fails with clear message if timeout exceeded
- Trace captures state at failure for debugging

### EC-6: Flaky Test Handling

**Scenario:** Test fails intermittently due to timing.

**Behavior:**
- Retry count of 2 configured in Playwright
- Trace captured on first retry for investigation
- Final failure after all retries exhausted
- Report indicates which attempt failed

### EC-7: Driver Script Without Build

**Scenario:** `pnpm e2e:drive` run without built app.

**Behavior:**
- Same validation as test fixture
- Error message instructs to run `pnpm build`
- Script exits with non-zero code

### EC-8: Interactive Mode Interrupt

**Scenario:** User presses Ctrl+C in interactive driver mode.

**Behavior:**
- Graceful shutdown initiated
- Electron app closed properly
- Temp resources cleaned up
- Shell returned to user

### EC-9: Unknown Test ID

**Scenario:** Click command targets non-existent testid.

**Behavior:**
- Playwright's `getByTestId` throws locator error
- Error message includes testid that wasn't found
- In interactive mode, prompt returns for next command
- In single command mode, exits with error

### EC-10: Large Repository Performance

**Scenario:** Test creates repository with 50+ commits or files.

**Behavior:**
- Tests in `large-repos.spec.ts` cover this scenario
- Performance metrics captured (load time, frame rate)
- Explicit timeout increases for known slow operations
- UI responsiveness verified after loading

---

## Test Coverage Structure

The test suite is organized by functionality:

```
tests/e2e/
├── fixtures/
│   ├── electronApp.ts      # Electron app lifecycle
│   ├── gitRepo.ts          # Git repository management
│   └── testWithRepo.ts     # Composite fixture
├── smoke.spec.ts           # Basic app launch (3 tests)
├── settings.spec.ts        # Settings dialog (4 tests)
├── repo-selection.spec.ts  # Repository UI (4 tests)
├── repo-workflow.spec.ts   # Loading workflow (5 tests)
├── ui-elements.spec.ts     # Element verification (7 tests)
├── keyboard-navigation.spec.ts # Accessibility (8 tests)
├── error-states.spec.ts    # Error handling (9 tests)
├── edge-cases.spec.ts      # Edge cases (12 tests)
├── branch-naming.spec.ts   # Branch names (14 tests)
├── complex-repos.spec.ts   # Complex structures (8 tests)
└── large-repos.spec.ts     # Performance (13 tests)
```

Total: 72 test cases across 11 spec files.

---

## Agent Development Workflow

AI agents can use the testing infrastructure for UI development with feedback:

### Workflow Steps

1. **Make Code Changes**: Agent edits component source files
2. **Build**: Run `pnpm build` to compile changes
3. **Capture State**: Use driver to screenshot and get accessibility tree
4. **Verify Changes**: Compare screenshots, analyze tree structure
5. **Iterate**: Fix issues and repeat until correct
6. **Write Tests**: Formalize working behavior as E2E tests

### Example Session

```bash
# Initial state
pnpm build
pnpm e2e:drive screenshot /tmp/01-before.png
pnpm e2e:drive snapshot > /tmp/01-tree.json

# After code changes
pnpm build
pnpm e2e:drive screenshot /tmp/02-after.png

# Test interactions
pnpm e2e:drive click settings-button
pnpm e2e:drive wait settings-dialog
pnpm e2e:drive screenshot /tmp/03-dialog.png
pnpm e2e:drive press Escape

# Verify dialog closed
pnpm e2e:drive snapshot | grep settings-dialog
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `TEAPOT_E2E` | Set to `1` to enable E2E mode (disables updater, enables isolation) |
| `TEAPOT_E2E_USER_DATA` | Custom userData path for test isolation |
| `CI` | Triggers `--no-sandbox` flag for Linux CI runners |
| `PLAYWRIGHT_BROWSERS_PATH` | Shared browser download location across worktrees |
| `PLAYWRIGHT_WS_PORT` | WebSocket server port for remote driving |

---

## Dependencies

- Playwright (`@playwright/test`) with Electron support
- Node.js filesystem APIs for temp directory management
- Git CLI available in PATH for repository fixtures
- Xvfb for CI display server (Linux only)
- GitHub Actions for CI workflow

---

## Out of Scope

- Visual regression testing (screenshot comparison)
- Cross-platform CI (Windows, macOS runners)
- Performance benchmarking with historical tracking
- Test parallelization across machines
- Browser-based testing (Electron only)
- Mobile/responsive testing
