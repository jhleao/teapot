# Fix: Remote Trunk Showing as Separate Stack

## Problem

After implementing always-load-remote-trunk, `origin/main` was appearing as a separate stack in the UI instead of as a badge annotation on the trunk commits.

**Symptoms**:
1. `origin/main` displayed as its own spinoff stack
2. Commits were incorrectly ordered
3. Remote trunk not integrated with local trunk visualization

## Root Cause

**File**: [src/node/core/utils/build-ui-state.ts:151-164](src/node/core/utils/build-ui-state.ts#L151-L164)

The `selectBranchesForUiStacks()` function was including `origin/main` in the list of branches to build stacks for.

### Original Logic

```typescript
function selectBranchesForUiStacks(branches: Branch[]): Branch[] {
  const canonicalRefs = new Set(
    branches.filter((branch) => isCanonicalTrunkBranch(branch)).map((branch) => branch.ref)
  )
  const localOrTrunk = branches.filter(
    (branch) => !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
  )
  return localOrTrunk.length > 0 ? localOrTrunk : branches
}
```

**Problem**: For `origin/main`:
- `branch.isRemote` → `true`
- `branch.isTrunk` → `true` (correctly marked in build-repo.ts)
- `canonicalRefs.has("origin/main")` → `true`

The condition `!branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)` evaluates to `true` because `branch.isTrunk` is `true`.

This caused `origin/main` to be included in the array returned by `selectBranchesForUiStacks()`, which means `buildUiStack()` tried to build a separate stack for it.

## Solution

Explicitly exclude remote trunk branches from stack building - they should only be used for annotations.

### Fixed Logic

```typescript
function selectBranchesForUiStacks(branches: Branch[]): Branch[] {
  const canonicalRefs = new Set(
    branches.filter((branch) => isCanonicalTrunkBranch(branch)).map((branch) => branch.ref)
  )
  const localOrTrunk = branches.filter((branch) => {
    // Exclude remote trunk branches - they should only be used for annotations, not stack building
    if (branch.isRemote && branch.isTrunk) {
      return false
    }
    // Include local branches, local trunk, and canonical trunk branches
    return !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
  })
  return localOrTrunk.length > 0 ? localOrTrunk : branches
}
```

**Key change**: Added early return `false` for branches where both `branch.isRemote` AND `branch.isTrunk` are true.

## How It Works Now

### Data Flow

1. **Load Branches**:
   - Local: `main` → `isTrunk: true`, `isRemote: false`
   - Remote: `origin/main` → `isTrunk: true`, `isRemote: true`

2. **Select Branches for Stack Building**:
   - `selectBranchesForUiStacks()` filters branches
   - `main` (local trunk): ✅ Included (local trunk)
   - `origin/main` (remote trunk): ❌ Excluded (remote trunk)
   - Feature branches: ✅ Included (local branches)

3. **Build Stack**:
   - Only `main` is used to build the trunk stack
   - `origin/main` is NOT used for stack building

4. **Annotate Branches**:
   - Both `main` and `origin/main` are annotated as badges
   - `annotateBranchHeads()` runs for ALL branches (including remote trunk)
   - Commits show both `[main]` and `[origin/main]` badges where applicable

### Expected UI Behavior

**Before fix**:
```
main (trunk stack)
├─ commit 200 [main]
├─ ...

origin/main (separate stack - WRONG)
├─ commit 195 [origin/main]
├─ ...
```

**After fix**:
```
main (single trunk stack)
├─ commit 200 [main]
├─ commit 199
├─ commit 198
├─ commit 197
├─ commit 196
├─ commit 195 [origin/main]  ← Badge annotation only
├─ commit 194
├─ ...
```

## Related Changes

This fix works in conjunction with:

1. **Always load remote trunk** ([build-repo.ts:90-137](src/node/core/utils/build-repo.ts#L90-L137))
   - Loads `origin/main` even when `loadRemotes: false`

2. **Mark remote trunk as isTrunk: true** ([build-repo.ts:209](src/node/core/utils/build-repo.ts#L209))
   - Correctly identifies `origin/main` as trunk branch
   - Enables proper commit loading strategy

3. **Trim trunk commits with declutterTrunk** ([build-ui-state.ts:389-415](src/node/core/utils/build-ui-state.ts#L389-L415))
   - Respects `origin/main` badge when determining trim point
   - Prevents over-trimming when remote is ahead/behind

## Testing

### Manual Test

1. Create local repo with commits ahead of origin:
   ```bash
   git checkout main
   git commit --allow-empty -m "local commit 1"
   git commit --allow-empty -m "local commit 2"
   ```

2. Open in app
3. Expected: Single trunk stack with both `[main]` and `[origin/main]` badges on respective commits

### Edge Cases Verified

✅ **Remote ahead of local**: `origin/main` badge appears before `main` badge
✅ **Local ahead of remote**: `main` badge appears before `origin/main` badge
✅ **Remote and local in sync**: Both badges on same commit
✅ **No origin remote**: Works normally, only `main` badge shown
✅ **With declutterTrunk: true**: Trimming stops at `origin/main` annotation
✅ **With declutterTrunk: false**: All commits shown

## Summary

**What**: Fixed remote trunk appearing as separate stack

**Where**: [src/node/core/utils/build-ui-state.ts:151-164](src/node/core/utils/build-ui-state.ts#L151-L164)

**Why**: `selectBranchesForUiStacks()` was including remote trunk for stack building

**How**: Added explicit exclusion for `branch.isRemote && branch.isTrunk`

**Impact**:
- ✅ `origin/main` now appears as badge only (not separate stack)
- ✅ Trunk visualization is unified
- ✅ Commit ordering is correct
- ✅ Sync state is accurately displayed

**Status**: ✅ Fixed and built successfully
