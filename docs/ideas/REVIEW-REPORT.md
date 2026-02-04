# Ideas Review Report

**Date:** 2026-02-04
**Reviewers:** Senior UX Engineers & Software Architects
**Scope:** All 15 idea documents in `/docs/ideas/`

---

## Executive Summary

A comprehensive review of all 15 idea documents was conducted to assess their value, feasibility, and alignment with the current codebase. The review resulted in the following recommendations:

- **IMPLEMENT**: 4 ideas (ready for implementation)
- **REFINE**: 6 ideas (need improvements before implementation)
- **DELETE**: 4 ideas (should be removed)
- **KEEP**: 1 idea (already implemented, no changes needed)

**Key Finding:** Several ideas are redundant or superseded by existing implementations. The most impactful recommendation is to implement **#16 Block Worktree Conflicts**, which would eliminate the need for 3 other related ideas.

---

## Review Summary Table

| # | Idea | Recommendation | Priority | Key Rationale |
|---|------|----------------|----------|---------------|
| 01 | Centralized Permission System | **IMPLEMENT** | Medium | Proven pattern (canDelete works), infrastructure exists |
| 02 | Instance-Based Services | **IMPLEMENT** | Medium-High | Solves real test isolation issues, backward compatible |
| 07 | Explicit Rebase Phase Tracking | **REFINE** | Medium | Unused RebasePhase.ts needs decision: integrate or delete |
| 09 | Worktree Abstraction Layer | **DELETE** | N/A | Already solved by `resolveGitDir()` in WorktreeUtils.ts |
| 11 | Worktree Telemetry | **REFINE** | Medium | Needs better UI placement and auto-fix options |
| 12 | Worktree Lock Mechanism | **DELETE** | N/A | Duplicates existing ExecutionContextService |
| 13 | Simplify Prune API | **REFINE** | Low | Minor inconsistency, documentation has errors |
| 14 | Git Error-First Pattern | **REFINE** | Medium | 60% overlap with #15 and #19 - should merge |
| 15 | Typed Git Error Classes | **REFINE** | Medium | Doesn't acknowledge existing errors.ts infrastructure |
| 16 | Block Worktree Conflicts | **IMPLEMENT** | **High** | Removes buggy auto-detach code, prevents orphaned states |
| 17 | Explicit Worktree Modification Consent | **IMPLEMENT** | Medium | Bundle with #16, simplifies code, improves trust |
| 18 | Decouple Execution Context Lifecycle | **DELETE** | N/A | Hypothetical problem, superseded by #16 |
| 19 | Consistent Error Handling Philosophy | **REFINE** | Low | Overlaps with #15, should merge |
| 20 | Branch Ownership Tracking | **DELETE** | N/A | 2-3 weeks effort vs #16's 1 week for same problem |
| 21 | Fork Point Independent Commits | **KEEP**/REFINE | Low | Core is done; enhancement needs rollback design |

---

## Detailed Reviews

### #01 - Centralized Permission System

**Recommendation: IMPLEMENT**
**Priority: Medium**

#### Summary
The idea proposes consolidating permission checks (canDelete, canRebase, canPush, etc.) into a centralized system with consistent patterns and user-facing disabled reasons.

#### Analysis
- **Existing Infrastructure**: The `canDelete` permission pattern is already implemented and working well
- **Proven Pattern**: Current implementation shows the approach works
- **UX Benefit**: Disabled reason tooltips help users understand why actions are unavailable
- **Low Risk**: Incremental migration possible

#### Action Items
- [ ] Extend the `canDelete` pattern to other permissions (canRebase, canPush, canMerge)
- [ ] Add tooltip support for disabled state reasons
- [ ] Create migration guide for existing permission checks

---

### #02 - Instance-Based Services for Testability

**Recommendation: IMPLEMENT**
**Priority: Medium-High**

#### Summary
Replace global singleton services with instance-based services to improve testability and eliminate shared state issues.

#### Analysis
- **Real Problem**: Test flakiness from shared global state is documented
- **Backward Compatible**: Can be implemented incrementally
- **Well-Designed**: Proposal includes clear migration path
- **Industry Standard**: Dependency injection is a proven pattern

#### Action Items
- [ ] Create service factory/container
- [ ] Migrate services one at a time
- [ ] Update test infrastructure to use fresh instances

---

### #07 - Explicit Rebase Phase Tracking

**Recommendation: REFINE**
**Priority: Medium**

#### Summary
Add explicit phase tracking to rebase operations (IDLE, PREPARING, REBASING, RESOLVING_CONFLICTS, FINALIZING).

#### Analysis
- **Code Exists But Unused**: `RebasePhase.ts` (464 lines) was built but never integrated
- **Decision Needed**: Either commit to using it or delete the dead code
- **Value Unclear**: Current rebase handling may be sufficient

#### Action Items
- [ ] Audit `RebasePhase.ts` usage - is it referenced anywhere?
- [ ] Decision: Integrate into rebase flow OR delete the file
- [ ] If keeping, add tests and documentation

---

### #09 - Worktree Abstraction Layer

**Recommendation: DELETE**
**Priority: N/A**

#### Summary
Proposes an abstraction layer for worktree operations to handle linked worktree edge cases.

#### Analysis
- **Already Solved**: `resolveGitDir()` in `WorktreeUtils.ts` handles the core problem
- **Redundant**: The abstraction described already exists in different form
- **No Additional Value**: Would add complexity without new functionality

#### Action Items
- [ ] Delete `09-worktree-abstraction-layer.md`
- [ ] Update README.md to remove reference

---

### #11 - Worktree Telemetry/Diagnostics

**Recommendation: REFINE**
**Priority: Medium**

#### Summary
Add telemetry and diagnostics for worktree operations to aid debugging and recovery.

#### Analysis
- **Valuable for Debugging**: Would help diagnose stale worktree issues
- **UI Placement Issue**: Buried in Settings is not discoverable
- **Missing Auto-Fix**: Should offer remediation, not just reporting

#### Refinements Needed
- [ ] Move diagnostics to contextual location (e.g., status bar indicator)
- [ ] Add "Fix" buttons for recoverable issues
- [ ] Reduce telemetry scope to actionable events only
- [ ] Add privacy considerations section

---

### #12 - Worktree Lock File Mechanism

**Recommendation: DELETE**
**Priority: N/A**

#### Summary
Proposes lock files to prevent concurrent worktree modifications.

#### Analysis
- **80-90% Already Exists**: `ExecutionContextService` provides this functionality
- **Duplicates Infrastructure**: Would create parallel locking systems
- **Maintenance Burden**: Two locking mechanisms to maintain

#### Action Items
- [ ] Delete `12-worktree-lock-mechanism.md`
- [ ] Document existing `ExecutionContextService` locking behavior
- [ ] Update README.md to remove reference

---

### #13 - Simplified pruneStaleWorktrees API

**Recommendation: REFINE**
**Priority: Low**

#### Summary
Simplify the API for pruning stale worktrees.

#### Analysis
- **Minor Issue**: Current API inconsistency is small
- **Low ROI**: Effort vs benefit ratio is poor
- **Documentation Errors**: The proposal document itself has errors

#### Refinements Needed
- [ ] Fix factual errors in the document
- [ ] Reduce scope to specific API changes
- [ ] Consider if this is worth implementing at all

---

### #14 - Git Error-First Pattern

**Recommendation: REFINE (MERGE)**
**Priority: Medium**

#### Summary
Adopt a "let Git decide" pattern where operations are attempted first and errors handled after.

#### Analysis
- **Sound Principle**: Error-first is cleaner than pre-checking
- **60% Overlap**: Significant overlap with #15 and #19
- **Should Merge**: Combine into unified error handling proposal

#### Action Items
- [ ] Merge #14, #15, #19 into single comprehensive error handling proposal
- [ ] Extract unique insights from each
- [ ] Delete individual documents after merge

---

### #15 - Typed Git Error Classes

**Recommendation: REFINE (MERGE)**
**Priority: Medium**

#### Summary
Create typed error classes for Git operations (GitConflictError, GitNotFoundError, etc.).

#### Analysis
- **Good Idea**: Type-safe errors improve developer experience
- **Ignores Existing Work**: `errors.ts` already has error infrastructure
- **Needs Consolidation**: Should build on existing, not replace

#### Action Items
- [ ] Audit existing `errors.ts` implementation
- [ ] Merge into unified error handling proposal with #14, #19
- [ ] Ensure backward compatibility with existing error handling

---

### #16 - Block All Worktree Conflicts During Rebase

**Recommendation: IMPLEMENT**
**Priority: HIGH**

#### Summary
Simply block rebases that would affect commits checked out in other worktrees, rather than attempting complex auto-detach logic.

#### Analysis
- **Removes Complexity**: Eliminates ~80 lines of buggy auto-detach code
- **Prevents Real Bugs**: Orphaned detached HEAD states are a real problem
- **User Trust**: Predictable "no" is better than unpredictable "maybe"
- **Enables Cleanup**: Implementing this makes #18 and #20 unnecessary

#### Action Items
- [ ] Remove auto-detach logic from rebase flow
- [ ] Add clear error message when worktree conflict detected
- [ ] Update user documentation
- [ ] After implementation, delete #18 and #20

---

### #17 - Explicit User Consent for Worktree Modifications

**Recommendation: IMPLEMENT (bundle with #16)**
**Priority: Medium**

#### Summary
Require explicit user consent before modifying worktrees during rebase operations.

#### Analysis
- **Nearly Identical to #16**: Same problem, same solution approach
- **Bundle Together**: Implement as part of #16
- **Simplifies Code**: Removes ambiguous automatic behavior

#### Action Items
- [ ] Implement alongside #16
- [ ] Design consent dialog if needed (or just block without consent)
- [ ] Consider merging documents into single proposal

---

### #18 - Decouple Execution Context from Finalization

**Recommendation: DELETE**
**Priority: N/A**

#### Summary
Separate execution context lifecycle from operation finalization.

#### Analysis
- **Hypothetical Problem**: Referenced issues don't exist in codebase
- **Superseded**: #16 solves the underlying concern more simply
- **No Concrete Examples**: Document lacks specific code references

#### Action Items
- [ ] Delete `18-decouple-execution-context-lifecycle.md`
- [ ] Update README.md to remove reference

---

### #19 - Consistent Error Handling Philosophy

**Recommendation: REFINE (MERGE)**
**Priority: Low**

#### Summary
Establish consistent error handling patterns across the codebase.

#### Analysis
- **Real Problem**: Inconsistent error handling exists
- **Overlaps #15**: Should be merged into unified proposal
- **Too Abstract**: Needs concrete fixes, not philosophy

#### Action Items
- [ ] Merge into unified error handling proposal with #14, #15
- [ ] Focus on specific, actionable patterns
- [ ] Delete individual document after merge

---

### #20 - Branch Ownership Tracking for Worktrees

**Recommendation: DELETE**
**Priority: N/A**

#### Summary
Track which worktree "owns" which branch to prevent conflicts.

#### Analysis
- **High Effort**: 2-3 weeks implementation estimate
- **Superseded by #16**: Blocking conflicts is simpler (1 week)
- **Over-Engineered**: Solves problem that #16 eliminates

#### Action Items
- [ ] Delete `20-branch-ownership-tracking.md`
- [ ] Update README.md to remove reference
- [ ] Implement #16 instead

---

### #21 - Fork Point Independent Commits

**Recommendation: KEEP (core) / REFINE (enhancement)**
**Priority: Low (for enhancement)**

#### Summary
Detect fork points and prevent rebases from unexpectedly moving shared ancestor commits.

#### Analysis
- **Core Is Done**: `isForkPoint()` and ownership stopping at fork points is implemented
- **Tests Exist**: 13+ test cases cover edge cases
- **Enhancement Risky**: Proposed drag-to-move-subtree needs better error handling

#### Action Items for Enhancement
- [ ] Design rollback strategy for partial failures
- [ ] Add undo mechanism for subtree operations
- [ ] Consider "Move Subtree" menu item instead of drag (less accidental)
- [ ] Keep document but mark core as "IMPLEMENTED"

---

## Recommended Implementation Order

### Phase 1: High Impact (Do First)
1. **#16 + #17**: Block Worktree Conflicts
   - Highest priority, eliminates need for #18 and #20
   - Estimated effort: 1 week

### Phase 2: Infrastructure Improvements
2. **#01**: Centralized Permission System
   - Extend existing canDelete pattern
   - Estimated effort: 2-3 days per permission

3. **#02**: Instance-Based Services
   - Improves test reliability
   - Estimated effort: 1-2 weeks (incremental)

### Phase 3: Error Handling Unification
4. **Merge #14 + #15 + #19**: Unified Error Handling Proposal
   - Create single comprehensive document
   - Estimated effort: 2-3 days to merge, 1-2 weeks to implement

### Phase 4: Cleanup
5. **#07**: Decide on RebasePhase.ts
   - Either integrate or delete the unused code
   - Estimated effort: 1 day to decide, 2-3 days to act

6. **#11**: Worktree Telemetry (refined)
   - After refining the proposal
   - Estimated effort: 1 week

### Phase 5: Deletions
7. Delete obsolete documents:
   - `09-worktree-abstraction-layer.md`
   - `12-worktree-lock-mechanism.md`
   - `18-decouple-execution-context-lifecycle.md`
   - `20-branch-ownership-tracking.md`

---

## Related Ideas Bundles

### Worktree Conflict Resolution (implement #16, delete rest)
- #16 Block Worktree Conflicts **<-- IMPLEMENT THIS**
- #17 Explicit User Consent (bundle with #16)
- #18 Decouple Execution Context **<-- DELETE**
- #20 Branch Ownership Tracking **<-- DELETE**

### Error Handling (merge into one)
- #14 Git Error-First Pattern
- #15 Typed Git Error Classes
- #19 Consistent Error Handling Philosophy

### Already Solved (delete)
- #09 Worktree Abstraction Layer (solved by resolveGitDir)
- #12 Worktree Lock Mechanism (solved by ExecutionContextService)

---

## Conclusion

The ideas repository contains valuable proposals but also significant redundancy. By implementing **#16 Block Worktree Conflicts** first, we can eliminate the need for 3 other proposals and significantly simplify the worktree-related code.

The error handling ideas (#14, #15, #19) should be merged into a single comprehensive proposal to avoid fragmentation and ensure consistency.

Four documents should be deleted as they describe problems that are either already solved or superseded by simpler solutions.

**Total Estimated Effort for All Recommendations:**
- High priority items: 2-3 weeks
- Medium priority items: 3-4 weeks
- Cleanup and deletions: 1-2 days
