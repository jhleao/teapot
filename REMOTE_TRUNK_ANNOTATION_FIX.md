# Fix: Remote Trunk Badge Missing and Commit Loading

## Problems Fixed

### Problem 1: Remote Trunk Badge Not Showing

**Symptom**: `origin/main` badge was completely missing from the UI

**Root Cause**: The fix that excluded remote trunk from stack building (`selectBranchesForUiStacks`) also prevented it from being annotated, because `annotationBranches` was derived from `UiStackBranches`.

**File**: [src/node/core/utils/build-ui-state.ts:84-102](src/node/core/utils/build-ui-state.ts#L84-L102)

**Original Code**:
```typescript
const annotationBranches = [...UiStackBranches].sort((a, b) => {
  // sorting logic
})
annotateBranchHeads(annotationBranches, state, gitForgeState)
```

**Issue**: Since `UiStackBranches` excluded `origin/main`, it was never passed to `annotateBranchHeads()`.

**Fix**: Separate annotation branches from stack-building branches:

```typescript
// For annotations, include ALL branches (including remote trunk)
// Remote trunk should not build a stack, but should still annotate commits
const allBranchesForAnnotation = [...repo.branches]
const annotationBranches = allBranchesForAnnotation.sort((a, b) => {
  // sorting logic
})
annotateBranchHeads(annotationBranches, state, gitForgeState)
```

**Result**: `origin/main` is now included in annotations while still excluded from stack building.

---

### Problem 2: Remote Trunk Loading Without Depth Limit

**Symptom**: Remote trunk was loading unlimited commits, potentially causing performance issues and incorrect commit counts

**Root Cause**: The commit loading logic treated remote trunk as a regular feature branch and loaded all commits without depth limit.

**File**: [src/node/core/utils/build-repo.ts:245-271](src/node/core/utils/build-repo.ts#L245-L271)

**Original Code**:
```typescript
// Skip trunk (already loaded with depth limit)
if (branch.isTrunk && !branch.isRemote) {
  continue
}

// Load feature branch completely (no depth limit)
await collectCommitsForRef(dir, descriptor.fullRef, commitsMap, {
  depth: undefined, // No depth limit for feature branches
  maxCommits: maxCommitsPerBranch // Safety limit only
})
```

**Issue**: For `origin/main`:
- `branch.isTrunk` → `true`
- `!branch.isRemote` → `false`
- Condition `branch.isTrunk && !branch.isRemote` → `false`
- Does NOT skip, loads with `depth: undefined` (unlimited)

This meant remote trunk could load MORE commits than local trunk, causing:
1. Performance degradation
2. Incorrect commit ordering/display
3. Inconsistent depth limits between local and remote trunk

**Fix**: Apply same depth limit to remote trunk as local trunk:

```typescript
// Skip local trunk (already loaded with depth limit in step 1)
if (branch.isTrunk && !branch.isRemote) {
  continue
}

// For remote trunk, use same depth limit as local trunk
// For feature branches, load completely (no depth limit)
const loadDepth = branch.isTrunk && branch.isRemote ? trunkDepth : undefined

await collectCommitsForRef(dir, descriptor.fullRef, commitsMap, {
  depth: loadDepth,
  maxCommits: maxCommitsPerBranch
})
```

**Result**: Remote trunk now respects the 200-commit depth limit, same as local trunk.

---

## How It Works Now

### Commit Loading Strategy

1. **Local trunk** (`main`):
   - Loaded in step 1 with `depth: 200`
   - Skipped in step 2

2. **Remote trunk** (`origin/main`):
   - Loaded in step 2 with `depth: 200` (same as local)
   - Ensures consistent depth limits

3. **Feature branches**:
   - Loaded in step 2 with `depth: undefined` (unlimited)
   - Small branches, so no performance concern

### Stack Building vs Annotation

**Stack Building** (determines which branches create stacks):
```typescript
selectBranchesForUiStacks(repo.branches)
// Returns: [local branches, local trunk]
// Excludes: remote trunk, other remote branches
```

**Annotation** (determines which branches get badges):
```typescript
const allBranchesForAnnotation = [...repo.branches]
// Includes: ALL branches (local, remote, trunk, feature)
```

**Result**:
- `main` builds the trunk stack ✅
- `origin/main` does NOT build a stack ✅
- Both `main` and `origin/main` get badge annotations ✅

### Expected UI Behavior

**Single trunk stack with badges**:
```
main (trunk)
├─ commit 200 [main]           ← local main points here
├─ commit 199
├─ commit 198
├─ commit 197
├─ commit 196
├─ commit 195 [origin/main]    ← remote trunk points here
├─ commit 194
├─ ...
└─ commit 1 (or trimmed if declutterTrunk: true)
```

**If local is ahead**:
```
main (trunk)
├─ commit 205 [main]           ← local ahead by 5
├─ commit 204
├─ commit 203
├─ commit 202
├─ commit 201
├─ commit 200 [origin/main]    ← remote trunk here
├─ commit 199
├─ ...
```

**If remote is ahead** (local hasn't pulled):
```
main (trunk)
├─ commit 205 [origin/main]    ← remote ahead by 5
├─ commit 204
├─ commit 203
├─ commit 202
├─ commit 201
├─ commit 200 [main]           ← local main here
├─ commit 199
├─ ...
```

## Summary of All Fixes

### Fix 1: Exclude Remote Trunk from Stack Building
**File**: [src/node/core/utils/build-ui-state.ts:151-164](src/node/core/utils/build-ui-state.ts#L151-L164)

Prevents `origin/main` from being treated as a separate stack.

### Fix 2: Include Remote Trunk in Annotations
**File**: [src/node/core/utils/build-ui-state.ts:84-87](src/node/core/utils/build-ui-state.ts#L84-L87)

Ensures `origin/main` badge is displayed on commits.

### Fix 3: Apply Depth Limit to Remote Trunk
**File**: [src/node/core/utils/build-repo.ts:263-270](src/node/core/utils/build-repo.ts#L263-L270)

Ensures consistent commit loading depth for local and remote trunk.

## Testing

### Test Cases

1. **Remote ahead of local**:
   ```bash
   # Reset local to 5 commits behind
   git reset --hard HEAD~5
   ```
   Expected: `origin/main` badge 5 commits ahead of `main` badge

2. **Local ahead of remote**:
   ```bash
   # Create 5 local commits
   for i in {1..5}; do git commit --allow-empty -m "local $i"; done
   ```
   Expected: `main` badge 5 commits ahead of `origin/main` badge

3. **Local and remote in sync**:
   ```bash
   git pull origin main
   ```
   Expected: Both `[main]` and `[origin/main]` badges on same commit

4. **No origin remote**:
   ```bash
   git remote remove origin
   ```
   Expected: Only `[main]` badge shown, no errors

## Build Status

✅ **TypeScript compilation**: Passed
✅ **Build**: Succeeded
✅ **All fixes applied**: Complete

## Impact

- ✅ Remote trunk badge now visible
- ✅ No separate stack for remote trunk
- ✅ Consistent commit depth limits
- ✅ Correct sync state display
- ✅ Better performance (no unlimited remote trunk loading)
