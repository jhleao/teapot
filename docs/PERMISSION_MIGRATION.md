# Permission System Migration

## Overview

This document outlines the migration of permission flags from scattered locations to a centralized `shared/permissions/` layer. This architecture enables:

1. **Frontend**: Show disabled UI with tooltips explaining why
2. **Backend Operations**: Validate before executing with meaningful errors
3. **MCP Server (future)**: Return structured errors to AI agents

## Alignment with Existing Architecture

Per `src/node/README.md`, the backend follows a layered architecture:

```
handlers/     → IPC entry points, routes requests to operations/services
operations/   → High-level orchestration, composes domain + services
services/     → Async I/O, external dependencies, caching
domain/       → Pure business logic, no I/O, deterministic
shared/       → Types, errors, constants used across all layers
```

Key principle: **"If it's used by 2+ layers, it belongs in shared/"**

Permission logic is:
- **Pure** (no I/O, deterministic) - qualifies for `domain/`
- **Used by both `web/` and `node/`** - must be in `shared/`

Therefore `shared/permissions/` is the correct location. This follows the existing pattern of `shared/git-url.ts` which contains pure utility functions used by multiple layers.

## Target Architecture

```
src/
├── shared/                          ← Cross-cutting: web/ + node/
│   ├── permissions/                 ← NEW: Pure permission logic
│   │   ├── delete-branch.ts
│   │   ├── rename-branch.ts
│   │   └── ...
│   └── types/
│       └── ui.ts                    ← Raw state only, no computed canXxx
│
├── web/
│   └── components/
│       └── BranchBadge.tsx          ← Calls getXxxPermission() for UI state
│
└── node/
    ├── domain/
    │   └── UiStateBuilder.ts        ← Provides raw state, no permission logic
    └── operations/
        └── BranchOperation.ts       ← Calls getXxxPermission() for validation
```

**Data flow:**

```
┌─────────────────────────────────────────────────────────────┐
│  shared/permissions/                                        │
│  Pure functions: (rawState) → { allowed, deniedReason }     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│  web/components/        │     │  node/operations/           │
│                         │     │                             │
│  Uses for:              │     │  Uses for:                  │
│  - disabled prop        │     │  - validation before exec   │
│  - disabledReason prop  │     │  - throw typed errors       │
└─────────────────────────┘     └─────────────────────────────┘
```

## Permission Flags Inventory

### ✅ Migrated

| Flag | Location | Status |
|------|----------|--------|
| `canDelete` (branch) | `shared/permissions/delete-branch.ts` | **Done** |

### 🔄 Needs Migration

#### Branch Permissions (UiBranch)

| Flag | Current Location | Rules | Needs Tooltip? |
|------|------------------|-------|----------------|
| `canRename` | `UiStateBuilder.ts:637` | `!isRemote && !isTrunk` | Yes - "Cannot rename trunk/remote branches" |
| `canFold` | `UiStateBuilder.ts:638` | `!isRemote && !isTrunk` | Yes - "Cannot fold trunk/remote branches" |
| `canCreateWorktree` | `UiStateBuilder.ts:639` | `!isRemote && !isTrunk` | Yes - "Cannot create worktree for trunk/remote branches" |

#### Commit Permissions

| Flag | Current Location | Rules | Status |
|------|------------------|-------|--------|
| `canEdit` (message) | `web/utils/edit-message-state.ts` | `!isTrunk && isHead` | **Already frontend pattern** - needs move to `shared/` |

#### Stack Permissions (UiStack)

| Flag | Current Location | Rules | Needs Tooltip? |
|------|------------------|-------|----------------|
| `canRebaseToTrunk` | `UiStateBuilder.ts:449` | `isDirectlyOffTrunk && baseSha !== trunkHeadSha` | Maybe - complex state |

## Migration Steps Per Flag

### 1. Create Permission Module in `shared/permissions/`

```typescript
// shared/permissions/rename-branch.ts
export type RenameBranchDeniedReason = 'is-trunk' | 'is-remote'

const DENIED_REASON_MESSAGES: Record<RenameBranchDeniedReason, string> = {
  'is-trunk': 'Cannot rename trunk branches',
  'is-remote': 'Cannot rename remote branches'
}

export type RenameBranchPermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: RenameBranchDeniedReason; deniedReason: string }

export function getRenameBranchPermission({
  isTrunk,
  isRemote
}: { isTrunk: boolean; isRemote: boolean }): RenameBranchPermission {
  if (isTrunk) {
    return { allowed: false, reason: 'is-trunk', deniedReason: DENIED_REASON_MESSAGES['is-trunk'] }
  }
  if (isRemote) {
    return { allowed: false, reason: 'is-remote', deniedReason: DENIED_REASON_MESSAGES['is-remote'] }
  }
  return { allowed: true, deniedReason: undefined }
}
```

### 2. Update Backend Operation

```typescript
// node/operations/BranchOperation.ts
static async rename(repoPath: string, oldName: string, newName: string): Promise<void> {
  const permission = getRenameBranchPermission({ isTrunk: isTrunkRef(oldName), isRemote: false })
  if (!permission.allowed) {
    if (permission.reason === 'is-trunk') {
      throw new TrunkProtectionError(oldName, 'rename')
    }
    throw new BranchError(permission.deniedReason, oldName, 'rename')
  }
  // ... execute
}
```

### 3. Update Frontend Component

```typescript
// web/components/BranchBadge.tsx
const renamePermission = useMemo(
  () => getRenameBranchPermission({ isTrunk: data.isTrunk, isRemote: data.isRemote }),
  [data.isTrunk, data.isRemote]
)

// In JSX:
<ContextMenuItem
  onClick={handleRename}
  disabled={!renamePermission.allowed}
  disabledReason={renamePermission.deniedReason}
>
  Rename branch
</ContextMenuItem>
```

### 4. Remove from UiStateBuilder

Remove computed `canXxx` from `UiBranch` type and `UiStateBuilder`. Frontend computes from raw state.

### 5. Update Tests

- Add tests to `shared/permissions/__tests__/`
- Update component tests to verify tooltip behavior

## Files to Modify Per Migration

For each permission flag:

1. **Create**: `shared/permissions/{operation}.ts`
2. **Update**: `shared/permissions/index.ts` (exports)
3. **Update**: `node/operations/XxxOperation.ts` (use permission)
4. **Update**: `web/components/Xxx.tsx` (use permission)
5. **Remove**: `shared/types/ui.ts` (remove `canXxx` field)
6. **Remove**: `node/domain/UiStateBuilder.ts` (remove computation)
7. **Update**: Test helpers in `__tests__/` directories

## Priority Order

1. **`canRename`** - Simple, similar to delete
2. **`canFold`** - Simple, similar to delete
3. **`canCreateWorktree`** - Simple, similar to delete
4. **`canEdit`** - Move existing `edit-message-state.ts` to `shared/permissions/`
5. **`canRebaseToTrunk`** - More complex, involves SHA comparison

## Notes

- Keep defense-in-depth checks in operations even after adding permission layer
- Use existing error types (`TrunkProtectionError`, `BranchError`) for consistency
- Permission modules should be pure functions with no side effects
- All user-facing messages should be in the `DENIED_REASON_MESSAGES` map for easy localization
