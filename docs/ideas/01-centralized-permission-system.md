# Idea: Centralized Permission System

**Source:** `docs/PERMISSION_MIGRATION.md`
**Status:** Partially Implemented (canDelete done, others pending)
**Priority:** High

## Problem

Permission flags are scattered across multiple locations:
- `UiStateBuilder.ts` computes `canRename`, `canFold`, `canCreateWorktree`
- `web/utils/edit-message-state.ts` has commit editing permissions
- Each location duplicates permission logic

This causes:
1. Frontend can't show tooltips explaining why actions are disabled
2. Backend operations must duplicate validation logic
3. No single source of truth for permission rules

## Proposed Solution

Create a centralized `shared/permissions/` layer with pure functions:

```typescript
// shared/permissions/rename-branch.ts
export function getRenameBranchPermission({
  isTrunk,
  isRemote
}: { isTrunk: boolean; isRemote: boolean }): Permission {
  if (isTrunk) {
    return { allowed: false, reason: 'is-trunk', deniedReason: 'Cannot rename trunk branches' }
  }
  if (isRemote) {
    return { allowed: false, reason: 'is-remote', deniedReason: 'Cannot rename remote branches' }
  }
  return { allowed: true, deniedReason: undefined }
}
```

## Benefits

1. **Frontend**: Show disabled UI with tooltips (`disabledReason` prop)
2. **Backend**: Validate before executing with meaningful errors
3. **MCP Server (future)**: Return structured errors to AI agents
4. **Localization**: All messages in one place

## Pending Migrations

| Permission | Current Location | Priority |
|------------|-----------------|----------|
| `canRename` | `UiStateBuilder.ts:637` | 1 |
| `canFold` | `UiStateBuilder.ts:638` | 2 |
| `canCreateWorktree` | `UiStateBuilder.ts:639` | 3 |
| `canEdit` (message) | `web/utils/edit-message-state.ts` | 4 |
| `canRebaseToTrunk` | `UiStateBuilder.ts:449` | 5 |

## Implementation Pattern

For each permission:
1. Create module in `shared/permissions/{operation}.ts`
2. Export permission function and types
3. Update backend operation to use permission
4. Update frontend component to use permission
5. Remove from `UiStateBuilder` and `UiBranch` type
6. Add tests

## Files to Modify

- `shared/permissions/` (new)
- `shared/permissions/index.ts` (exports)
- `node/operations/XxxOperation.ts`
- `web/components/Xxx.tsx`
- `shared/types/ui.ts` (remove `canXxx` fields)
- `node/domain/UiStateBuilder.ts` (remove computation)

---

## Architecture Design Decision

### ADR-001: Pure Functions in Shared Layer

**Decision:** Permission logic implemented as pure functions in `shared/permissions/`, not as methods on domain objects.

**Rationale:**
- Pure functions are trivially testable (no mocks needed)
- Can be imported by both frontend and backend
- No hidden dependencies or side effects
- Composable for complex permission checks

**Alternatives Considered:**
1. **Methods on UiBranch**: Rejected - couples permission logic to UI representation
2. **Service class**: Rejected - adds unnecessary abstraction for stateless logic
3. **Decorator pattern**: Rejected - over-engineering for simple boolean checks

### ADR-002: Permission Return Type

**Decision:** Return `Permission` object with `allowed`, `reason`, and `deniedReason` fields.

```typescript
type Permission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: string; deniedReason: string }
```

**Rationale:**
- `reason` is machine-readable key for conditional logic
- `deniedReason` is human-readable for UI tooltips
- Discriminated union ensures exhaustive handling

---

## First Implementation Steps

### Step 1: Create Permission Types (30 min)

```typescript
// src/shared/permissions/types.ts
export type PermissionReason =
  | 'is-trunk'
  | 'is-remote'
  | 'has-uncommitted-changes'
  | 'rebase-in-progress'
  // ... extensible

export type Permission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: PermissionReason; deniedReason: string }

export function allowed(): Permission {
  return { allowed: true, deniedReason: undefined }
}

export function denied(reason: PermissionReason, message: string): Permission {
  return { allowed: false, reason, deniedReason: message }
}
```

### Step 2: Implement First Permission - canRename (1 hour)

```typescript
// src/shared/permissions/rename-branch.ts
import { Permission, allowed, denied } from './types'

export interface RenameBranchInput {
  isTrunk: boolean
  isRemote: boolean
  isCurrentBranch: boolean
  hasOpenPR: boolean
}

export function getRenameBranchPermission(input: RenameBranchInput): Permission {
  if (input.isTrunk) {
    return denied('is-trunk', 'Cannot rename the trunk branch')
  }
  if (input.isRemote) {
    return denied('is-remote', 'Cannot rename remote-only branches')
  }
  if (input.hasOpenPR) {
    return denied('has-open-pr', 'Cannot rename branch with open PR')
  }
  return allowed()
}
```

### Step 3: Integrate with Backend Operation (1 hour)

```typescript
// src/node/operations/BranchOperation.ts
import { getRenameBranchPermission } from '@shared/permissions/rename-branch'

static async rename(repoPath: string, oldName: string, newName: string): Promise<RenameResult> {
  const branch = await this.getBranchInfo(repoPath, oldName)

  const permission = getRenameBranchPermission({
    isTrunk: branch.isTrunk,
    isRemote: branch.isRemote,
    isCurrentBranch: branch.isCurrent,
    hasOpenPR: branch.pr !== undefined
  })

  if (!permission.allowed) {
    return { success: false, error: permission.deniedReason }
  }

  // ... existing rename logic
}
```

### Step 4: Integrate with Frontend (1 hour)

```typescript
// src/web/components/BranchContextMenu.tsx
const renamePermission = getRenameBranchPermission({
  isTrunk: branch.isTrunk,
  isRemote: !branch.isLocal,
  isCurrentBranch: branch.isCurrent,
  hasOpenPR: branch.pr !== undefined
})

<MenuItem
  disabled={!renamePermission.allowed}
  title={renamePermission.deniedReason}
  onClick={handleRename}
>
  Rename
</MenuItem>
```

### Step 5: Remove from UiStateBuilder (30 min)

1. Remove `canRename` from `UiBranch` type in `shared/types/ui.ts`
2. Remove computation from `UiStateBuilder.ts:637`
3. Update any tests that check `canRename`

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Input shape diverges between FE/BE | Single `XxxInput` type in shared layer |
| Missing permission check in operation | Add lint rule requiring permission check before mutation |
| Stale permission in UI after state change | Recompute on render, not in builder |
