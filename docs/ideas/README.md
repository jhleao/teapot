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

## Priority Summary

### High Priority (implement soon)
1. **Centralized Permission System** - Partially done, quick wins available
2. **Instance-Based Services** - Fixes test flakiness
3. **Rate Limit Handling** - Prevents API limit issues
4. **Timeout Implementation** - Fixes "Reply never sent" errors
5. **Explicit Phase Tracking** - Prevents rebase dialog bugs
6. **Worktree Abstraction** - Fixes linked worktree bugs
7. **Worktree Telemetry** - Enables observability

### Medium Priority (consider next)
- GraphQL API - Reduces API calls significantly
- State Immutability - Prevents watcher interference
- Context Validation - Self-healing on corrupt state
- Worktree Locking - Race condition prevention

### Low Priority (nice to have)
- GitHub Webhooks - Requires infrastructure
- Simplified Prune API - Maintainability improvement

## Recommended Implementation Order

1. **Quick wins first**:
   - Simplified Prune API (1-2 hours)
   - Permission System migrations (2-3 hours each)

2. **Reliability improvements**:
   - Timeout Implementation
   - Instance-Based Services
   - Worktree Abstraction Layer

3. **State machine improvements**:
   - Explicit Phase Tracking
   - State Immutability

4. **Observability**:
   - Worktree Telemetry
   - Context Validation

5. **API efficiency**:
   - Rate Limit Handling
   - GraphQL API

6. **Advanced features**:
   - Worktree Locking (if telemetry shows race conditions)
   - GitHub Webhooks (if polling is insufficient)
