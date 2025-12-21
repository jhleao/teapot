# Backend Architecture

## Layer Overview

```
handlers/     → IPC entry points, routes requests to operations/services
operations/   → High-level orchestration, composes domain + services
services/     → Async I/O, external dependencies, caching
domain/       → Pure business logic, no I/O, deterministic
shared/       → Types, errors, constants used across all layers
```

## Design Principles

**Purity Gradient**: I/O is pushed to the edges. Domain is 100% pure (testable without mocks). Services contain all I/O. Operations compose them. Handlers route.

**Static Classes**: Domain classes are static-only. They group related pure functions, not state.

## Layer Rules

### shared/

- Zero dependencies on other layers
- Contains typed error hierarchy, constants
- If it's used by 2+ layers, it belongs here

### domain/

- Depends only on `shared/`
- All functions are synchronous and deterministic
- No git commands, no network, no file system
- Given the same input, always returns the same output

### services/

- Depends on `shared/` and `domain/`
- Wraps external dependencies (git adapter, GitHub API)
- Manages caches and sessions
- Provides consistent interfaces over I/O operations

### operations/

- Depends on `shared/`, `domain/`, and `services/`
- Orchestrates multi-step workflows
- Combines pure logic with I/O to implement features
- One operation = one user-facing capability

### handlers/

- Depends on all layers
- Thin IPC routing layer
- Transforms requests to operation/service calls
- Never contains business logic

## Data Flow

```
IPC Request
    ↓
Handler (routes)
    ↓
Operation (orchestrates)
    ↓
┌─────────────────┐
│ Service (I/O)   │ ←→ Git / GitHub / Cache
│ Domain (logic)  │
└─────────────────┘
    ↓
IPC Response
```

## Key Abstractions

| Abstraction    | Purpose                            |
| -------------- | ---------------------------------- |
| `Repo`         | Complete repository state snapshot |
| `RebaseIntent` | Declarative rebase plan            |
| `UiStack`      | UI-ready branch tree               |
