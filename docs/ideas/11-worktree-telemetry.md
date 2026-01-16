# Idea: Operation Diagnostics & Telemetry Service

**Source:** `docs/proposals/worktree-improvements.md`, user feedback on stuck rebase states
**Status:** Proposed (Revised)
**Priority:** High (observability + debugging)
**Effort:** Medium-High (1.5-2 weeks)

## Problem

Users experience issues that are difficult to diagnose and reproduce:

1. **"Stuck in Git Rebasing state"**: UI shows rebasing indefinitely with no progress or feedback, requiring manual `git rebase --abort`
2. **Branches disappear**: After manual intervention, some branches are lost and require re-committing work
3. **No ad-hoc debugging**: No way to capture state/logs when issues occur
4. **Systemic issues undetected**: Frequent stale worktrees, orphaned contexts, and state mismatches go unnoticed
5. **Recovery guidance missing**: When things break, users don't know what git commands could fix the issue

### Root Causes (from code analysis)

The "stuck rebasing" issue can occur when:

1. **Context/session mismatch**: Session exists in `.git/teapot-rebase-session.json` but execution context is gone
2. **Temp worktree orphaned**: Rebase runs in temp worktree that crashed/wasn't cleaned up
3. **UI projection stale**: Session status is 'running' but no job is actively 'applying'
4. **Lock file stale**: `.git/teapot-exec.lock` blocks operations but wasn't released
5. **State divergence**: Session says job is 'applying' but git isn't actually rebasing

## Proposed Solution

Replace the narrow "Worktree Telemetry" concept with a comprehensive **Diagnostics Service** that:

1. **Tracks operation lifecycle** - Start, progress, completion, failure for all operations
2. **Detects anomalies** - Long-running operations, state mismatches, orphaned resources
3. **Captures state snapshots** - On-demand diagnostic dumps for debugging
4. **Suggests recovery** - Actionable git commands when errors occur
5. **Aggregates metrics** - Success rates, timing, error frequency

---

## Event Schema

### Base Event Structure

```typescript
interface BaseEvent {
  timestamp: number
  repoPath: string
  correlationId?: string  // Links related events (e.g., session ID)
}
```

### Operation Lifecycle Events

```typescript
type OperationEvent = BaseEvent & (
  // Rebase operations
  | { type: 'rebase_started'; sessionId: string; jobCount: number; isTemporaryWorktree: boolean }
  | { type: 'rebase_job_started'; sessionId: string; jobId: string; branch: string; jobIndex: number }
  | { type: 'rebase_job_completed'; sessionId: string; jobId: string; durationMs: number }
  | { type: 'rebase_conflict_detected'; sessionId: string; jobId: string; branch: string; conflictCount: number }
  | { type: 'rebase_conflict_resolved'; sessionId: string; jobId: string; resolutionMs: number }
  | { type: 'rebase_completed'; sessionId: string; totalDurationMs: number; jobsCompleted: number }
  | { type: 'rebase_aborted'; sessionId: string; reason: 'user' | 'error' | 'recovery'; phase: string }
  | { type: 'rebase_failed'; sessionId: string; errorCode: string; phase: string; recoveryCommands?: string[] }

  // Worktree operations
  | { type: 'worktree_created'; path: string; isTemporary: boolean; operation: string }
  | { type: 'worktree_removed'; path: string; wasStale: boolean; durationMs: number }
  | { type: 'worktree_stale_detected'; path: string; reason: 'marked_prunable' | 'directory_missing' | 'orphaned' }
  | { type: 'worktree_prune_attempted'; success: boolean; error?: string; durationMs: number }
  | { type: 'worktree_retry_triggered'; operation: string; attempt: number; maxAttempts: number }

  // Execution context lifecycle
  | { type: 'context_acquired'; isTemporary: boolean; operation: string }
  | { type: 'context_stored'; operation: string; reason: 'conflict' | 'pause' }
  | { type: 'context_released'; durationMs: number; wasCleanup: boolean }
  | { type: 'context_stale_cleared'; ageMs: number }
  | { type: 'context_orphans_cleaned'; count: number }

  // Lock operations
  | { type: 'lock_acquired'; waitTimeMs: number; retries: number }
  | { type: 'lock_released'; heldForMs: number }
  | { type: 'lock_stale_broken'; ageMs: number }
)
```

### Anomaly Detection Events

```typescript
type AnomalyEvent = BaseEvent & (
  | {
      type: 'state_mismatch_detected'
      description: string
      hasSession: boolean
      hasContext: boolean
      gitIsRebasing: boolean
      sessionStatus?: string
      suggestedAction: 'abort' | 'continue' | 'clear_session' | 'clear_context'
      recoveryCommands: string[]
    }
  | {
      type: 'operation_stuck'
      operation: 'rebase' | 'checkout' | 'sync'
      sessionId?: string
      durationMs: number
      phase: string
      recoveryCommands: string[]
    }
  | {
      type: 'orphaned_resource_detected'
      resourceType: 'worktree' | 'context' | 'session' | 'lock'
      path: string
      ageMs: number
    }
)
```

---

## DiagnosticsService Architecture

```typescript
// src/node/services/DiagnosticsService.ts

import { EventEmitter } from 'events'

export type DiagnosticsEvent = OperationEvent | AnomalyEvent

export interface DiagnosticsStats {
  // Operation counts (last hour)
  rebaseStarted: number
  rebaseCompleted: number
  rebaseFailed: number
  rebaseAborted: number

  // Success rates
  rebaseSuccessRate: number
  worktreePruneSuccessRate: number

  // Timing
  avgRebaseDurationMs: number
  avgConflictResolutionMs: number

  // Anomalies
  stateMismatchCount: number
  stuckOperationCount: number
  orphanedResourceCount: number
  staleContextsCleared: number
}

export interface StateSnapshot {
  timestamp: number
  repoPath: string

  // Git state
  gitStatus: {
    isRebasing: boolean
    isMerging: boolean
    isCherryPicking: boolean
    head: string
    branch: string | null
  }

  // Teapot state
  session: {
    exists: boolean
    id?: string
    status?: string
    startedAtMs?: number
    ageMs?: number
    activeJobId?: string
    activeJobStatus?: string
  }

  // Execution context
  context: {
    hasStored: boolean
    storedPath?: string
    storedAgeMs?: number
    isStale: boolean
    operation?: string
  }

  // Resources
  resources: {
    lockExists: boolean
    lockAgeMs?: number
    tempWorktreeCount: number
    orphanedWorktreeCount: number
  }

  // Recent events
  recentEvents: DiagnosticsEvent[]

  // Recovery suggestions
  suggestedRecovery?: {
    action: string
    reason: string
    commands: string[]
  }
}

export class DiagnosticsService {
  private static events: DiagnosticsEvent[] = []
  private static readonly MAX_EVENTS = 2000
  private static readonly PERSIST_INTERVAL_MS = 60_000
  private static readonly STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

  private static emitter = new EventEmitter()

  // ─────────────────────────────────────────────────────────────
  // Event Recording
  // ─────────────────────────────────────────────────────────────

  static record(event: Omit<DiagnosticsEvent, 'timestamp'>): void {
    const timestampedEvent = { ...event, timestamp: Date.now() } as DiagnosticsEvent

    this.events.push(timestampedEvent)

    // Ring buffer rotation
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift()
    }

    // Emit for real-time listeners (UI updates)
    this.emitter.emit('event', timestampedEvent)

    // Log for file-based debugging
    log.debug('[Diagnostics]', timestampedEvent)

    // Check for anomalies on certain event types
    this.checkForAnomalies(timestampedEvent)
  }

  // ─────────────────────────────────────────────────────────────
  // State Snapshot (on-demand diagnostics)
  // ─────────────────────────────────────────────────────────────

  static async captureSnapshot(repoPath: string): Promise<StateSnapshot> {
    const [
      gitStatus,
      session,
      contextHealth,
    ] = await Promise.all([
      this.getGitStatus(repoPath),
      SessionService.get(repoPath),
      ExecutionContextService.healthCheck(repoPath),
    ])

    const snapshot: StateSnapshot = {
      timestamp: Date.now(),
      repoPath,
      gitStatus,
      session: {
        exists: !!session,
        id: session?.id,
        status: session?.state?.session?.status,
        startedAtMs: session?.state?.session?.startedAtMs,
        ageMs: session ? Date.now() - session.state.session.startedAtMs : undefined,
        activeJobId: session?.state?.queue?.activeJobId,
        activeJobStatus: session?.state?.queue?.activeJobId
          ? session.state.jobsById[session.state.queue.activeJobId]?.status
          : undefined,
      },
      context: {
        hasStored: contextHealth.hasStoredContext,
        storedPath: contextHealth.storedContext?.executionPath,
        storedAgeMs: contextHealth.storedContextAge ?? undefined,
        isStale: contextHealth.isStoredContextStale,
        operation: contextHealth.storedContext?.operation,
      },
      resources: {
        lockExists: contextHealth.lockFileExists,
        lockAgeMs: contextHealth.lockFileAge ?? undefined,
        tempWorktreeCount: contextHealth.tempWorktreeCount,
        orphanedWorktreeCount: await this.countOrphanedWorktrees(repoPath),
      },
      recentEvents: this.getEvents({ repoPath, limit: 50 }),
      suggestedRecovery: this.suggestRecovery(gitStatus, session, contextHealth),
    }

    // Also record that we captured a snapshot (useful for tracking diagnostic usage)
    this.record({
      type: 'state_snapshot_captured' as any, // Extension point
      repoPath,
    })

    return snapshot
  }

  // ─────────────────────────────────────────────────────────────
  // Recovery Suggestions
  // ─────────────────────────────────────────────────────────────

  private static suggestRecovery(
    gitStatus: StateSnapshot['gitStatus'],
    session: any,
    contextHealth: any
  ): StateSnapshot['suggestedRecovery'] | undefined {

    // Case 1: Session exists but git isn't rebasing
    if (session && !gitStatus.isRebasing) {
      if (contextHealth.hasStoredContext) {
        return {
          action: 'Clear stale session and context',
          reason: 'Session exists but git is not rebasing. The operation may have completed or crashed.',
          commands: [
            `rm "${contextHealth.storedContext.executionPath}/.git/teapot-rebase-session.json"`,
            `rm "${contextHealth.storedContext.executionPath}/.git/teapot-exec-context.json"`,
          ],
        }
      }
      return {
        action: 'Clear orphaned session',
        reason: 'Session exists but no execution context. Session is orphaned.',
        commands: [
          `rm ".git/teapot-rebase-session.json"`,
        ],
      }
    }

    // Case 2: Git is rebasing but no session
    if (!session && gitStatus.isRebasing) {
      return {
        action: 'Abort orphaned git rebase',
        reason: 'Git is in rebase state but Teapot has no session. Manual intervention required.',
        commands: [
          'git rebase --abort',
        ],
      }
    }

    // Case 3: Stale lock file
    if (contextHealth.lockFileExists && contextHealth.lockFileAge > 5 * 60 * 1000) {
      return {
        action: 'Break stale lock',
        reason: `Lock file is ${Math.round(contextHealth.lockFileAge / 60000)} minutes old.`,
        commands: [
          `rm ".git/teapot-exec.lock"`,
        ],
      }
    }

    // Case 4: Session stuck for too long
    if (session && session.state.session.status === 'running') {
      const ageMs = Date.now() - session.state.session.startedAtMs
      if (ageMs > this.STUCK_THRESHOLD_MS) {
        return {
          action: 'Session appears stuck',
          reason: `Rebase session has been running for ${Math.round(ageMs / 60000)} minutes.`,
          commands: [
            'git rebase --abort',
            `rm ".git/teapot-rebase-session.json"`,
            `rm ".git/teapot-exec-context.json"`,
          ],
        }
      }
    }

    return undefined
  }

  // ─────────────────────────────────────────────────────────────
  // Anomaly Detection
  // ─────────────────────────────────────────────────────────────

  private static checkForAnomalies(event: DiagnosticsEvent): void {
    // Check for stuck operations when rebase starts
    if (event.type === 'rebase_started') {
      this.scheduleStuckCheck(event.repoPath, event.sessionId)
    }
  }

  private static stuckCheckTimers = new Map<string, NodeJS.Timeout>()

  private static scheduleStuckCheck(repoPath: string, sessionId: string): void {
    // Clear any existing timer for this session
    const existing = this.stuckCheckTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    // Schedule check after threshold
    const timer = setTimeout(async () => {
      const session = await SessionService.get(repoPath)
      if (session?.id === sessionId && session.state.session.status === 'running') {
        // Still running after threshold - likely stuck
        const snapshot = await this.captureSnapshot(repoPath)

        this.record({
          type: 'operation_stuck',
          repoPath,
          correlationId: sessionId,
          operation: 'rebase',
          sessionId,
          durationMs: Date.now() - session.state.session.startedAtMs,
          phase: session.state.phase?.kind ?? 'unknown',
          recoveryCommands: snapshot.suggestedRecovery?.commands ?? [],
        })
      }
      this.stuckCheckTimers.delete(sessionId)
    }, this.STUCK_THRESHOLD_MS)

    timer.unref() // Don't keep process alive
    this.stuckCheckTimers.set(sessionId, timer)
  }

  // ─────────────────────────────────────────────────────────────
  // Query & Stats
  // ─────────────────────────────────────────────────────────────

  static getEvents(filter?: {
    type?: string
    repoPath?: string
    since?: number
    correlationId?: string
    limit?: number
  }): DiagnosticsEvent[] {
    let result = [...this.events]

    if (filter?.type) {
      result = result.filter(e => e.type === filter.type)
    }
    if (filter?.repoPath) {
      result = result.filter(e => e.repoPath === filter.repoPath)
    }
    if (filter?.since) {
      result = result.filter(e => e.timestamp >= filter.since)
    }
    if (filter?.correlationId) {
      result = result.filter(e => e.correlationId === filter.correlationId)
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit)
    }

    return result
  }

  static getStats(repoPath?: string, windowMs = 60 * 60 * 1000): DiagnosticsStats {
    const since = Date.now() - windowMs
    const events = this.getEvents({ repoPath, since })

    const rebaseStarted = events.filter(e => e.type === 'rebase_started').length
    const rebaseCompleted = events.filter(e => e.type === 'rebase_completed').length
    const rebaseFailed = events.filter(e => e.type === 'rebase_failed').length
    const rebaseAborted = events.filter(e => e.type === 'rebase_aborted').length

    const completedEvents = events.filter(e => e.type === 'rebase_completed') as any[]
    const avgRebaseDurationMs = completedEvents.length > 0
      ? completedEvents.reduce((sum, e) => sum + e.totalDurationMs, 0) / completedEvents.length
      : 0

    const pruneEvents = events.filter(e => e.type === 'worktree_prune_attempted') as any[]
    const pruneSuccess = pruneEvents.filter(e => e.success).length

    return {
      rebaseStarted,
      rebaseCompleted,
      rebaseFailed,
      rebaseAborted,
      rebaseSuccessRate: rebaseStarted > 0 ? (rebaseCompleted / rebaseStarted) * 100 : 100,
      worktreePruneSuccessRate: pruneEvents.length > 0 ? (pruneSuccess / pruneEvents.length) * 100 : 100,
      avgRebaseDurationMs,
      avgConflictResolutionMs: this.calculateAvgConflictResolution(events),
      stateMismatchCount: events.filter(e => e.type === 'state_mismatch_detected').length,
      stuckOperationCount: events.filter(e => e.type === 'operation_stuck').length,
      orphanedResourceCount: events.filter(e => e.type === 'orphaned_resource_detected').length,
      staleContextsCleared: events.filter(e => e.type === 'context_stale_cleared').length,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Export & Persistence
  // ─────────────────────────────────────────────────────────────

  static async export(repoPath?: string): Promise<string> {
    const snapshot = repoPath
      ? await this.captureSnapshot(repoPath)
      : null

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      stats: this.getStats(repoPath),
      snapshot,
      events: this.getEvents({ repoPath }),
    }, null, 2)
  }

  // ─────────────────────────────────────────────────────────────
  // Event Subscription (for UI)
  // ─────────────────────────────────────────────────────────────

  static on(event: 'event', listener: (event: DiagnosticsEvent) => void): void {
    this.emitter.on(event, listener)
  }

  static off(event: 'event', listener: (event: DiagnosticsEvent) => void): void {
    this.emitter.off(event, listener)
  }
}
```

---

## State Synchronization Check

Add a periodic health check that detects mismatches (the "stuck rebasing" issue):

```typescript
// src/node/services/DiagnosticsService.ts (continued)

export class DiagnosticsService {
  // ... previous code ...

  private static syncCheckInterval: NodeJS.Timeout | null = null

  static startPeriodicSyncCheck(repoPath: string, intervalMs = 30_000): void {
    this.stopPeriodicSyncCheck()

    this.syncCheckInterval = setInterval(async () => {
      await this.checkStateSync(repoPath)
    }, intervalMs)

    this.syncCheckInterval.unref()
  }

  static stopPeriodicSyncCheck(): void {
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval)
      this.syncCheckInterval = null
    }
  }

  static async checkStateSync(repoPath: string): Promise<void> {
    const gitStatus = await this.getGitStatus(repoPath)
    const session = await SessionService.get(repoPath)
    const contextHealth = await ExecutionContextService.healthCheck(repoPath)

    const hasSession = !!session
    const hasContext = contextHealth.hasStoredContext
    const gitIsRebasing = gitStatus.isRebasing

    // Detect mismatches
    let mismatch = false
    let description = ''
    let suggestedAction: 'abort' | 'continue' | 'clear_session' | 'clear_context' = 'clear_session'
    const recoveryCommands: string[] = []

    // Session but no git rebase
    if (hasSession && !gitIsRebasing && !hasContext) {
      mismatch = true
      description = 'Session exists but git is not rebasing and no execution context'
      suggestedAction = 'clear_session'
      recoveryCommands.push(`rm ".git/teapot-rebase-session.json"`)
    }

    // Context but no session
    if (hasContext && !hasSession) {
      mismatch = true
      description = 'Execution context exists but no session'
      suggestedAction = 'clear_context'
      recoveryCommands.push(`rm "${contextHealth.storedContext?.executionPath}/.git/teapot-exec-context.json"`)
    }

    // Git rebasing but no session or context
    if (gitIsRebasing && !hasSession && !hasContext) {
      mismatch = true
      description = 'Git is rebasing but Teapot has no session or context'
      suggestedAction = 'abort'
      recoveryCommands.push('git rebase --abort')
    }

    // Stale context
    if (contextHealth.isStoredContextStale) {
      mismatch = true
      description = `Execution context is stale (${Math.round((contextHealth.storedContextAge ?? 0) / 3600000)}h old)`
      suggestedAction = 'clear_context'
      recoveryCommands.push(`rm "${contextHealth.storedContext?.executionPath}/.git/teapot-exec-context.json"`)
    }

    if (mismatch) {
      this.record({
        type: 'state_mismatch_detected',
        repoPath,
        description,
        hasSession,
        hasContext,
        gitIsRebasing,
        sessionStatus: session?.state?.session?.status,
        suggestedAction,
        recoveryCommands,
      })
    }
  }
}
```

---

## Instrumentation Points

### RebaseExecutor

```typescript
// src/node/operations/RebaseExecutor.ts

async function executeSession(repoPath: string, session: RebaseSession): Promise<RebaseResult> {
  const sessionId = session.id

  DiagnosticsService.record({
    type: 'rebase_started',
    repoPath,
    correlationId: sessionId,
    sessionId,
    jobCount: session.jobs.length,
    isTemporaryWorktree: true,
  })

  try {
    for (const jobId of session.jobs) {
      const job = session.jobsById[jobId]
      const jobStartTime = Date.now()

      DiagnosticsService.record({
        type: 'rebase_job_started',
        repoPath,
        correlationId: sessionId,
        sessionId,
        jobId,
        branch: job.branch,
        jobIndex: session.jobs.indexOf(jobId),
      })

      const result = await executeJob(job)

      if (result.status === 'conflict') {
        DiagnosticsService.record({
          type: 'rebase_conflict_detected',
          repoPath,
          correlationId: sessionId,
          sessionId,
          jobId,
          branch: job.branch,
          conflictCount: result.conflicts.length,
        })
      } else {
        DiagnosticsService.record({
          type: 'rebase_job_completed',
          repoPath,
          correlationId: sessionId,
          sessionId,
          jobId,
          durationMs: Date.now() - jobStartTime,
        })
      }
    }

    DiagnosticsService.record({
      type: 'rebase_completed',
      repoPath,
      correlationId: sessionId,
      sessionId,
      totalDurationMs: Date.now() - session.startedAtMs,
      jobsCompleted: session.jobs.length,
    })

  } catch (error) {
    const snapshot = await DiagnosticsService.captureSnapshot(repoPath)

    DiagnosticsService.record({
      type: 'rebase_failed',
      repoPath,
      correlationId: sessionId,
      sessionId,
      errorCode: error.code ?? 'GENERIC',
      phase: session.phase?.kind ?? 'unknown',
      recoveryCommands: snapshot.suggestedRecovery?.commands,
    })

    throw error
  }
}
```

### ExecutionContextService (leverage existing events)

```typescript
// src/node/services/ExecutionContextService.ts

// Already has EventEmitter! Just pipe to DiagnosticsService:
contextEvents.on('acquired', (context, repoPath) => {
  DiagnosticsService.record({
    type: 'context_acquired',
    repoPath,
    isTemporary: context.isTemporary,
    operation: context.operation,
  })
})

contextEvents.on('staleCleared', (repoPath, ageMs) => {
  DiagnosticsService.record({
    type: 'context_stale_cleared',
    repoPath,
    ageMs,
  })
})

contextEvents.on('orphansCleanedUp', (repoPath, count) => {
  DiagnosticsService.record({
    type: 'context_orphans_cleaned',
    repoPath,
    count,
  })
})
```

---

## UI: Diagnostics Panel

Add to Settings or Developer Tools:

```typescript
// src/web/components/DiagnosticsPanel.tsx

function DiagnosticsPanel({ repoPath }: { repoPath: string }) {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [stats, setStats] = useState<DiagnosticsStats | null>(null)
  const [events, setEvents] = useState<DiagnosticsEvent[]>([])

  const refreshDiagnostics = async () => {
    const [s, st, e] = await Promise.all([
      ipc.invoke('diagnostics:captureSnapshot', repoPath),
      ipc.invoke('diagnostics:getStats', repoPath),
      ipc.invoke('diagnostics:getEvents', { repoPath, limit: 100 }),
    ])
    setSnapshot(s)
    setStats(st)
    setEvents(e)
  }

  return (
    <div className="diagnostics-panel">
      <header>
        <h2>Diagnostics</h2>
        <Button onClick={refreshDiagnostics}>Refresh</Button>
        <Button onClick={handleExport}>Export for Support</Button>
      </header>

      {/* Current State */}
      <section>
        <h3>Current State</h3>
        {snapshot && (
          <StateIndicators snapshot={snapshot} />
        )}

        {snapshot?.suggestedRecovery && (
          <RecoveryCard recovery={snapshot.suggestedRecovery} />
        )}
      </section>

      {/* Stats */}
      <section>
        <h3>Last Hour</h3>
        <StatsGrid>
          <Stat label="Rebases" value={`${stats?.rebaseCompleted}/${stats?.rebaseStarted}`} />
          <Stat label="Success Rate" value={`${stats?.rebaseSuccessRate.toFixed(0)}%`} />
          <Stat label="Avg Duration" value={formatDuration(stats?.avgRebaseDurationMs)} />
          <Stat label="State Mismatches" value={stats?.stateMismatchCount} warning={stats?.stateMismatchCount > 0} />
          <Stat label="Stuck Operations" value={stats?.stuckOperationCount} warning={stats?.stuckOperationCount > 0} />
        </StatsGrid>
      </section>

      {/* Event Log */}
      <section>
        <h3>Recent Events</h3>
        <EventList events={events} />
      </section>
    </div>
  )
}

function RecoveryCard({ recovery }: { recovery: StateSnapshot['suggestedRecovery'] }) {
  return (
    <div className="recovery-card warning">
      <h4>⚠️ {recovery.action}</h4>
      <p>{recovery.reason}</p>
      <div className="recovery-commands">
        <p>To fix manually, run:</p>
        {recovery.commands.map((cmd, i) => (
          <code key={i}>{cmd}</code>
        ))}
        <Button onClick={() => copyToClipboard(recovery.commands.join('\n'))}>
          Copy Commands
        </Button>
      </div>
    </div>
  )
}
```

---

## IPC Endpoints

```typescript
// src/shared/types/ipc.ts
export const IpcChannels = {
  // ... existing channels ...

  // Diagnostics
  'diagnostics:captureSnapshot': 'diagnostics:captureSnapshot',
  'diagnostics:getStats': 'diagnostics:getStats',
  'diagnostics:getEvents': 'diagnostics:getEvents',
  'diagnostics:export': 'diagnostics:export',
  'diagnostics:checkStateSync': 'diagnostics:checkStateSync',
} as const

// src/node/handlers/diagnosticsHandler.ts
ipcMain.handle('diagnostics:captureSnapshot', async (_, repoPath: string) => {
  return DiagnosticsService.captureSnapshot(repoPath)
})

ipcMain.handle('diagnostics:getStats', async (_, repoPath?: string) => {
  return DiagnosticsService.getStats(repoPath)
})

ipcMain.handle('diagnostics:getEvents', async (_, filter) => {
  return DiagnosticsService.getEvents(filter)
})

ipcMain.handle('diagnostics:export', async (_, repoPath?: string) => {
  return DiagnosticsService.export(repoPath)
})

ipcMain.handle('diagnostics:checkStateSync', async (_, repoPath: string) => {
  await DiagnosticsService.checkStateSync(repoPath)
})
```

---

## Architecture Decisions

### ADR-001: Comprehensive Operation Tracking (Revised)

**Decision:** Track all operation types, not just worktrees.

**Rationale:** The "stuck rebasing" issue requires tracking rebase lifecycle, execution context, and state synchronization—not just worktrees.

### ADR-002: State Snapshots for Debugging

**Decision:** Provide on-demand state snapshots that capture git state, session state, context state, and resources.

**Rationale:** Users need to capture state when issues occur. Logs alone don't show the full picture.

### ADR-003: Recovery Command Suggestions

**Decision:** When anomalies are detected, suggest specific git commands to fix the issue.

**Rationale:** Users shouldn't have to guess how to recover. Actionable recovery commands reduce frustration and data loss.

### ADR-004: Leverage Existing EventEmitter

**Decision:** Pipe `ExecutionContextService.events` into `DiagnosticsService` rather than duplicating instrumentation.

**Rationale:** The EventEmitter pattern already exists. Use it rather than adding redundant logging calls.

### ADR-005: Periodic Sync Checks

**Decision:** Run state synchronization checks every 30 seconds while a repo is open.

**Rationale:** Detects "stuck" states that would otherwise go unnoticed until the user manually investigates.

### ADR-006: Ring Buffer with Higher Capacity

**Decision:** Increase from 1000 to 2000 events since we're tracking more event types.

**Rationale:** With rebase job events and sync checks, the original 1000 limit would fill too quickly.

---

## Implementation Order

### Phase 1: Core Service (3 days)
1. Create `DiagnosticsService` with event recording and ring buffer
2. Define event types (OperationEvent, AnomalyEvent)
3. Implement `captureSnapshot()` and recovery suggestions
4. Add periodic persistence

### Phase 2: Instrumentation (2 days)
1. Instrument `RebaseExecutor` with lifecycle events
2. Pipe `ExecutionContextService.events` to diagnostics
3. Add worktree operation instrumentation
4. Implement state sync check

### Phase 3: UI & IPC (2 days)
1. Add IPC handlers for diagnostics
2. Create `DiagnosticsPanel` component
3. Add export functionality
4. Wire up to Settings/DevTools

### Phase 4: Polish (2 days)
1. Add stuck operation detection with timers
2. Tune thresholds (stuck timeout, sync check interval)
3. Test recovery suggestions
4. Document usage

---

## Success Metrics

After implementation, we should see:

1. **Stuck rebase detection**: `operation_stuck` events when rebases take >5 minutes
2. **State mismatch visibility**: `state_mismatch_detected` events when UI shows wrong state
3. **Recovery actionability**: Users can copy-paste suggested commands to fix issues
4. **Diagnostic exports**: Support tickets include state snapshots for faster debugging

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Performance impact from periodic checks | Checks are lightweight (file reads only), interval configurable |
| Event buffer fills with noisy events | Per-event-type filtering, higher buffer size |
| Privacy (repo paths in exports) | Exports are local-only, user-initiated |
| Timer leaks | All timers use `.unref()`, cleanup on repo close |
| False positive "stuck" detection | Conservative 5-minute threshold, manual confirmation before auto-action |
