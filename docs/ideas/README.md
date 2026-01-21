# Extracted Ideas from Docs

This directory contains individual idea documents extracted from the `/docs` folder, including post-mortems, proposals, and design documents.

## Ideas by Category

### Architecture & Testing
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 01 | [Centralized Permission System](./01-centralized-permission-system.md) | High | PERMISSION_MIGRATION.md |
| 02 | [Instance-Based Services for Testability](./02-instance-based-services.md) | High | change-request-remove-global-state.md |

### GitHub API Improvements
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 03 | [GitHub Webhooks for Real-Time Updates](./03-github-webhooks-realtime.md) | Low | future-improvements-status-checks.md |
| 04 | [Rate Limit Handling](./04-rate-limit-handling.md) | High | future-improvements-status-checks.md |
| 05 | [GraphQL API for GitHub](./05-graphql-api-github.md) | Medium | future-improvements-status-checks.md |

### Reliability & Robustness
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 06 | [Timeout Implementation for Async Ops](./06-timeout-implementation.md) | High | timeout-implementation.md |

### Rebase State Machine
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 07 | [Explicit Phase Tracking for Rebase](./07-explicit-rebase-phase-tracking.md) | High | post-mortems/2025-01-resume-rebase-queue-dialog.md |
| 08 | [State Immutability During Operations](./08-state-immutability-operations.md) | Medium | post-mortems/2025-01-resume-rebase-queue-dialog.md |

### Worktree Management
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 09 | [Worktree Abstraction Layer](./09-worktree-abstraction-layer.md) | High | post-mortems/2026-01-parallel-rebase-temp-worktree-conflicts.md |
| 10 | [Context Validation on Load](./10-context-validation-on-load.md) | Medium | post-mortems/2026-01-parallel-rebase-temp-worktree-conflicts.md |
| 11 | [Stale Worktree Recovery Telemetry](./11-worktree-telemetry.md) | High | proposals/worktree-improvements.md |
| 12 | [Worktree Lock File Mechanism](./12-worktree-lock-mechanism.md) | Medium | proposals/worktree-improvements.md |
| 13 | [Simplified pruneStaleWorktrees API](./13-simplify-prune-api.md) | Low | proposals/worktree-improvements.md |

### Git Error Handling
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 14 | [Git Error-First Pattern ("Let Git Decide")](./14-git-error-first-pattern.md) | High | 2339-worktree-branch-deletion.md (post-mortem) |
| 15 | [Typed Git Error Classes](./15-typed-git-error-classes.md) | High | 2339-worktree-branch-deletion.md (post-mortem) |

### Worktree Conflict Handling
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 16 | [Block All Worktree Conflicts During Rebase](./16-block-worktree-conflicts.md) | High | worktree-rebase-conflicts.md |
| 17 | [Explicit User Consent for Worktree Modifications](./17-explicit-worktree-modification-consent.md) | High | architecture-issues-rebase-worktree-lifecycle.md |

### Execution Context & Lifecycle
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 18 | [Decouple Execution Context from Finalization](./18-decouple-execution-context-lifecycle.md) | Medium | architecture-issues-rebase-worktree-lifecycle.md |
| 19 | [Consistent Error Handling Philosophy](./19-consistent-error-handling-philosophy.md) | Medium | architecture-issues-rebase-worktree-lifecycle.md |
| 20 | [Branch Ownership Tracking for Worktrees](./20-branch-ownership-tracking.md) | Medium | architecture-issues-rebase-worktree-lifecycle.md |

### Commit Ownership & UI
| # | Idea | Priority | Source |
|---|------|----------|--------|
| 21 | [Fork Point Independent Commits](./21-fork-point-independent-commits.md) | Medium | UX analysis of commit ownership ambiguity |

## Priority Summary

### High Priority (implement soon)
1. **Centralized Permission System** - Partially done, quick wins available
2. **Instance-Based Services** - Fixes test flakiness
3. **Rate Limit Handling** - Prevents API limit issues
4. **Timeout Implementation** - Fixes "Reply never sent" errors
5. **Explicit Phase Tracking** - Prevents rebase dialog bugs
6. **Worktree Abstraction** - Fixes linked worktree bugs
7. **Worktree Telemetry** - Enables observability
8. **Git Error-First Pattern** - Simpler, more reliable error handling
9. **Typed Git Error Classes** - Type-safe error handling
10. **Block Worktree Conflicts** - Prevents silent worktree modifications
11. **Explicit User Consent** - User trust and predictability

### Medium Priority (consider next)
- GraphQL API - Reduces API calls significantly
- State Immutability - Prevents watcher interference
- Context Validation - Self-healing on corrupt state
- Worktree Locking - Race condition prevention
- Decouple Execution Context - Cleaner lifecycle management
- Consistent Error Handling - Predictable behavior
- Branch Ownership Tracking - Explicit branch management
- Fork Point Independent Commits - Prevents surprising sibling branch rebases (core implemented)

### Low Priority (nice to have)
- GitHub Webhooks - Requires infrastructure
- Simplified Prune API - Maintainability improvement

## Recommended Implementation Order

1. **Quick wins first**:
   - Simplified Prune API (1-2 hours)
   - Permission System migrations (2-3 hours each)

2. **Git error handling improvements**:
   - Typed Git Error Classes (#15)
   - Git Error-First Pattern (#14)

3. **Worktree conflict resolution**:
   - Block Worktree Conflicts (#16)
   - Explicit User Consent (#17)
   - *Note: #16 and #17 are closely related and should be implemented together*

4. **Reliability improvements**:
   - Timeout Implementation
   - Instance-Based Services
   - Worktree Abstraction Layer

5. **State machine improvements**:
   - Explicit Phase Tracking
   - State Immutability
   - Consistent Error Handling (#19)

6. **Lifecycle improvements**:
   - Decouple Execution Context (#18)
   - Branch Ownership Tracking (#20)

7. **Observability**:
   - Worktree Telemetry
   - Context Validation

8. **API efficiency**:
   - Rate Limit Handling
   - GraphQL API

9. **Advanced features**:
   - Worktree Locking (if telemetry shows race conditions)
   - GitHub Webhooks (if polling is insufficient)

## Related Ideas

Some ideas are closely related and should be considered together:

### Worktree Conflict Resolution Bundle
- #16 Block Worktree Conflicts
- #17 Explicit User Consent
- #20 Branch Ownership Tracking

These three ideas address the same underlying problem: managing worktree state during rebases. Implementing #16 first (blocking conflicts) is the simplest approach. If more sophisticated handling is needed later, #17 and #20 provide the infrastructure.

### Error Handling Bundle
- #14 Git Error-First Pattern
- #15 Typed Git Error Classes
- #19 Consistent Error Handling Philosophy

These ideas work together to create a coherent error handling strategy. Start with #15 (typed errors), then apply #14 (error-first pattern), and use #19 to ensure consistency.

### Execution Context Bundle
- #18 Decouple Execution Context
- #20 Branch Ownership Tracking

Both ideas address lifecycle management of temporary worktrees. #18 focuses on phase separation, while #20 focuses on branch references. They complement each other.

### Ownership Concepts Bundle
- #20 Branch Ownership Tracking (worktree-branch ownership)
- #21 Fork Point Independent Commits (commit-branch ownership)

Both deal with "ownership" but at different levels. #20 tracks which worktree owns a branch reference, while #21 tracks which branch owns which commits. The fork point feature (#21 core) is implemented; the drag feature extends rebase operations.
