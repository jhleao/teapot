# Teapot E2E Testing Plan

## Overview

This document outlines the strategy for making Teapot's Playwright E2E harness fully functional and agent-drivable.

## Current State Assessment

### What Works

- ✅ `playwright run-server` exists and functions (contrary to earlier reports)
- ✅ Basic Electron app fixture (`tests/e2e/fixtures/electronApp.ts`)
- ✅ Smoke test passes (checks window title)
- ✅ Playwright config properly set up for Electron
- ✅ E2E environment isolation via `TEAPOT_E2E` env vars

### What's Missing

1. **No data-testid attributes** - UI components lack test selectors
2. **No git repo fixtures** - Tests can't exercise real git workflows
3. **Only trivial smoke test** - No tests for actual user journeys
4. **Agent-driving documentation unclear** - Need MCP server integration docs

## Agent-Driven Testing Architecture

### Playwright MCP Server Approach

Playwright 1.57+ includes built-in agent support via:

```bash
npx playwright run-test-mcp-server
```

This exposes tools like:

- `browser_navigate`, `browser_click`, `browser_type`
- `browser_snapshot` - get accessibility tree
- `generator_setup_page`, `generator_write_test`

Agents connect via MCP and can drive browsers directly.

### Generated Agent Infrastructure

Running `playwright init-agents --loop claude --prompts` generates:

- `.claude/agents/` - Agent definitions for test generation/healing
- `.claude/prompts/` - Prompt templates
- `.mcp.json` - MCP server configuration
- `specs/README.md` - Directory for test plans

### Remote WebSocket Server

For multi-worktree scenarios:

```bash
PLAYWRIGHT_WS_PORT=9339 pnpm e2e:serve
```

Other agents connect: `pw.connect({ wsEndpoint: 'ws://localhost:9339' })`

## Implementation Plan

### Phase 1: Test Infrastructure ✅

1. ~~Initialize agent tooling~~ (`playwright init-agents --loop claude`)
2. Create git repo fixture for isolated test repos
3. Add comprehensive Electron test fixture improvements

### Phase 2: UI Test Selectors

Add `data-testid` attributes to key components:

| Component          | Test IDs                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| App.tsx            | `app-container`, `settings-button`                                       |
| EmptyState.tsx     | `empty-state`, `empty-state-action`                                      |
| Topbar.tsx         | `topbar`, `repo-metadata`                                                |
| RepoSelector.tsx   | `repo-selector`, `repo-dropdown`, `add-repo-button`, `clone-repo-button` |
| StackView.tsx      | `stack-view`, `commit-[sha]`, `sync-button`                              |
| SettingsDialog.tsx | `settings-dialog`                                                        |

### Phase 3: Git Repo Fixture

Create `tests/e2e/fixtures/gitRepo.ts`:

- Initialize bare git repo in temp directory
- Create initial commit with sample files
- Configure git user for test environment
- Provide cleanup utilities
- Support creating branches/commits programmatically

### Phase 4: E2E Test Cases

#### Test 1: Repository Selection Flow

```
1. App starts with no repo selected
2. Verify EmptyState is shown
3. Use folder picker mock to select test repo
4. Verify repo loads and StackView appears
```

#### Test 2: Settings Dialog

```
1. Open app with valid repo
2. Click settings button
3. Verify settings dialog opens
4. Close dialog
5. Verify it closes properly
```

#### Test 3: Git Repository Display

```
1. Setup test repo with commits
2. Open app pointing to test repo
3. Verify commits display in StackView
4. Verify branch information shown
```

### Phase 5: Documentation Update

Update `docs/testing/playwright.md`:

- Accurate commands and workflow
- Agent-driving instructions
- MCP server usage
- Troubleshooting guide

## Success Criteria

1. `pnpm e2e` passes with 3+ meaningful tests
2. Agent can drive tests via MCP server
3. Tests exercise real Teapot workflows (repo selection, commit display)
4. Documentation accurately reflects capabilities
5. Test fixtures are reusable and hermetic

## File Changes Summary

### New Files

- `products/teapot/E2E_PLAN.md` (this file)
- `tests/e2e/fixtures/gitRepo.ts`
- `tests/e2e/repo-selection.spec.ts`
- `tests/e2e/settings.spec.ts`
- `.claude/` directory (from init-agents)
- `.mcp.json`
- `specs/README.md`
- `seed.spec.ts`

### Modified Files

- `src/web/App.tsx` - add data-testid
- `src/web/components/EmptyState.tsx` - add data-testid
- `src/web/components/Topbar.tsx` - add data-testid
- `src/web/components/RepoSelector.tsx` - add data-testid
- `src/web/components/StackView.tsx` - add data-testid
- `src/web/components/SettingsDialog.tsx` - add data-testid
- `docs/testing/playwright.md` - update documentation
- `package.json` - (if needed for new scripts)

## Timeline

| Phase | Description                | Status                         |
| ----- | -------------------------- | ------------------------------ |
| 1     | Infrastructure setup       | ✅ Complete                    |
| 2     | Add data-testid attributes | ✅ Complete                    |
| 3     | Git repo fixture           | ✅ Complete                    |
| 4     | E2E test cases             | ✅ Complete (11 passing tests) |
| 5     | Documentation              | ✅ Complete                    |

## Results Summary

All 11 E2E tests pass in ~17 seconds:

- 3 smoke tests (basic app functionality)
- 4 repository selection/dropdown tests
- 4 settings dialog tests

Key improvements made:

- Fixed ConfigStore lazy initialization for proper test isolation
- Added data-testid attributes to 8 key UI components
- Fixed DialogContent to pass through HTML attributes
- Created reusable git repo fixture
- Updated comprehensive documentation
