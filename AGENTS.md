# AGENTS.md

## Project Overview

Teapot is an Electron desktop application for managing Git stacks and pull requests. It provides a visual interface for working with stacked branches, rebasing, and GitHub PR operations.

## Commands

```bash
# Development
pnpm dev              # Start development with frontend only hot reload
pnpm dev:watch        # Development with fullstack hot reload

# Code quality
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # Full TypeScript check (node + web)
pnpm typecheck:node   # TypeScript check for main process
pnpm typecheck:web    # TypeScript check for renderer

# Testing
pnpm test             # Run all tests
pnpm test:watch       # Watch mode
pnpm test -- src/node/domain/__tests__/BranchUtils.test.ts  # Run single test file
```

## Architecture

The backend follows a layered architecture with strict dependency rules:

```
handlers/     → IPC entry points, routes requests to operations/services
operations/   → High-level orchestration, composes domain + services
services/     → Async I/O, external dependencies, caching
domain/       → Pure business logic, no I/O, deterministic
shared/       → Types, errors, constants used across all layers
```

### Layer Rules

- **shared/**: Zero dependencies on other layers. Types and constants only.
- **domain/**: Depends only on `shared/`. All functions are synchronous and deterministic. No git commands, no network, no file system.
- **services/**: Depends on `shared/` and `domain/`. Wraps external dependencies (git adapter, GitHub API).
- **operations/**: Depends on all above layers. Orchestrates multi-step workflows.
- **handlers/**: Thin IPC routing layer. Never contains business logic.

### Key Directories

```
src/
├── node/                    # Electron main process
│   ├── adapters/git/        # Git operations (SimpleGitAdapter)
│   ├── adapters/forge/      # GitHub API integration
│   ├── domain/              # Pure business logic (static classes)
│   ├── services/            # I/O operations
│   ├── operations/          # Feature orchestration
│   └── handlers/            # IPC entry points
├── web/                     # React frontend
│   ├── components/          # React components
│   └── contexts/            # State management (LocalState, UiState, ForgeState, Drag)
├── web-preload/             # Electron preload script
└── shared/                  # Shared types and utilities
    └── types/               # IPC, repo, rebase, UI types
```

### Key Abstractions

| Abstraction    | Purpose                            |
| -------------- | ---------------------------------- |
| `Repo`         | Complete repository state snapshot |
| `RebaseIntent` | Declarative rebase plan            |
| `UiStack`      | UI-ready branch tree               |
| `RebaseState`  | Rebase session + jobs + queue      |

### Path Alias

Use `@shared` to import from `src/shared/` (configured in tsconfig and vitest).

## Testing

Tests are co-located with source code in `__tests__` directories. Domain and operation logic have the most comprehensive test coverage since they contain core business logic.

### Unit Tests

```bash
pnpm test             # Run all unit tests
pnpm test:watch       # Watch mode
pnpm test -- src/node/domain/__tests__/BranchUtils.test.ts  # Single file
```

### E2E Tests (Playwright)

E2E tests use Playwright with Electron to test the full application.

```bash
pnpm build            # Required: build the app first
pnpm e2e              # Run all E2E tests
pnpm e2e -- --headed  # Run with visible window (for debugging)
pnpm e2e:clean        # Clean temp repos and artifacts
```

See `docs/testing/playwright.md` for full documentation.

### Agent-Assisted Test Development

Claude agents can help write and maintain E2E tests using the Playwright MCP server:

| Agent | Purpose |
|-------|---------|
| `playwright-test-planner` | Create test plans from requirements |
| `playwright-test-generator` | Generate tests by driving the browser |
| `playwright-test-healer` | Fix broken tests using traces |

Agents are defined in `.claude/agents/` with prompts in `.claude/prompts/`.

## Additional Documentation

- `src/node/README.md` - Backend architecture details
- `src/node/REBASING.md` - Rebase algorithm and state machine
- `docs/testing/playwright.md` - E2E testing guide
