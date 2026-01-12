# Idea: Stale Worktree Recovery Telemetry

**Source:** `docs/proposals/worktree-improvements.md`
**Status:** Proposed
**Priority:** High (observability)
**Effort:** Medium (1 week)

## Problem

No visibility into how often stale worktree recovery occurs in production:

1. **Systemic issues go undetected**: Frequent stale worktrees indicate deeper problems (crashes, improper shutdown)
2. **Performance impact invisible**: Prune operations add latency without visibility
3. **Debugging difficult**: No data about worktree corruption in user reports
4. **Success rate unknown**: Recovery mechanisms effectiveness unmeasured

## Proposed Solution

Add metrics and telemetry to track worktree recovery:

### Telemetry Events

```typescript
export type WorktreeTelemetryEvent = {
  type: 'worktree_stale_detected'
  reason: 'marked_prunable' | 'directory_missing'
  worktreePath: string
  operation: 'checkout' | 'cleanup' | 'delete' | 'rebase'
} | {
  type: 'worktree_prune_attempted'
  success: boolean
  error?: string
  durationMs: number
} | {
  type: 'worktree_retry_triggered'
  operation: string
  attempt: number
  worktreePath: string
}
```

### Telemetry Service

```typescript
export class TelemetryService {
  private static events: WorktreeTelemetryEvent[] = []
  private static readonly MAX_EVENTS = 1000

  static record(event: WorktreeTelemetryEvent): void {
    this.events.push({ ...event, timestamp: Date.now() })

    // Rotate buffer
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS)
    }

    log.info('[Telemetry]', event)
  }

  static getStats(): WorktreeTelemetryStats { ... }
  static export(): string { ... } // JSON for support tickets
}
```

### Instrumentation Points

```typescript
// In pruneStaleWorktrees
const startTime = Date.now()
try {
  await git.pruneWorktrees(repoPath)
  TelemetryService.record({
    type: 'worktree_prune_attempted',
    success: true,
    durationMs: Date.now() - startTime
  })
} catch (error) {
  TelemetryService.record({
    type: 'worktree_prune_attempted',
    success: false,
    error: message,
    durationMs: Date.now() - startTime
  })
}
```

### Developer Tools UI

Add "Diagnostics" section in settings:
- Recent worktree events
- Aggregate statistics (prune count, success rate, avg duration)
- Export button for support tickets

## Metrics to Track

- Count of stale worktrees detected (by reason)
- Count of successful/failed prunes
- Count of retries via `retryWithPrune`
- Time spent in recovery operations
- Frequency patterns (hourly/daily)

---

## Architecture Design Decision

### ADR-001: In-Memory Ring Buffer with Periodic Persistence

**Decision:** Store events in memory ring buffer (max 1000), persist to disk periodically.

**Rationale:**
- Low overhead for recording events
- No I/O on hot path
- Can export for debugging without impacting performance
- Ring buffer prevents unbounded memory growth

**Alternatives Considered:**
1. **Immediate file write**: Rejected - I/O overhead on every event
2. **External telemetry service**: Rejected - adds complexity, privacy concerns
3. **No storage (logs only)**: Rejected - can't aggregate or analyze patterns

### ADR-002: Static Singleton Service

**Decision:** `TelemetryService` as static class with module-level state.

**Rationale:**
- Easy to call from anywhere: `TelemetryService.record(event)`
- Telemetry is inherently global (app-wide metrics)
- No need for dependency injection here
- Simple to mock in tests: `vi.spyOn(TelemetryService, 'record')`

### ADR-003: Structured Event Types

**Decision:** Use discriminated union for event types, not free-form objects.

**Rationale:**
- Type safety catches missing fields at compile time
- Self-documenting event schema
- Enables specific aggregation logic per event type

---

## First Implementation Steps

### Step 1: Define Event Types (30 min)

```typescript
// src/node/services/TelemetryService.ts

interface BaseEvent {
  timestamp: number
}

export type WorktreeTelemetryEvent = BaseEvent & (
  | {
      type: 'worktree_stale_detected'
      reason: 'marked_prunable' | 'directory_missing' | 'orphaned'
      worktreePath: string
      operation: string
    }
  | {
      type: 'worktree_prune_attempted'
      success: boolean
      error?: string
      durationMs: number
    }
  | {
      type: 'worktree_retry_triggered'
      operation: string
      attempt: number
      maxAttempts: number
    }
  | {
      type: 'context_validation_failed'
      reason: string
      repoPath: string
    }
)
```

### Step 2: Implement Ring Buffer Service (1 hour)

```typescript
export class TelemetryService {
  private static events: WorktreeTelemetryEvent[] = []
  private static readonly MAX_EVENTS = 1000
  private static readonly PERSIST_INTERVAL_MS = 60_000 // 1 minute

  static {
    // Start periodic persistence
    setInterval(() => this.persistToDisk(), this.PERSIST_INTERVAL_MS).unref()
  }

  static record(event: Omit<WorktreeTelemetryEvent, 'timestamp'>): void {
    const timestampedEvent = { ...event, timestamp: Date.now() }

    this.events.push(timestampedEvent)

    // Ring buffer rotation
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift()
    }

    // Also log for immediate visibility
    log.debug('[Telemetry]', timestampedEvent)
  }

  static getEvents(filter?: { type?: string; since?: number }): WorktreeTelemetryEvent[] {
    let result = [...this.events]

    if (filter?.type) {
      result = result.filter(e => e.type === filter.type)
    }
    if (filter?.since) {
      result = result.filter(e => e.timestamp >= filter.since)
    }

    return result
  }

  static getStats(): TelemetryStats {
    const now = Date.now()
    const lastHour = now - 60 * 60 * 1000
    const recentEvents = this.events.filter(e => e.timestamp >= lastHour)

    return {
      totalEvents: this.events.length,
      eventsLastHour: recentEvents.length,
      pruneAttempts: recentEvents.filter(e => e.type === 'worktree_prune_attempted').length,
      pruneSuccessRate: this.calculateSuccessRate('worktree_prune_attempted'),
      staleDetections: recentEvents.filter(e => e.type === 'worktree_stale_detected').length,
    }
  }

  static export(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      stats: this.getStats(),
      events: this.events
    }, null, 2)
  }

  private static async persistToDisk(): Promise<void> {
    const telemetryPath = path.join(app.getPath('userData'), 'telemetry.json')
    try {
      await fs.promises.writeFile(telemetryPath, this.export())
    } catch (error) {
      log.warn('[Telemetry] Failed to persist', error)
    }
  }
}
```

### Step 3: Instrument Worktree Operations (1 hour)

```typescript
// src/node/utils/WorktreeUtils.ts
export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
  const startTime = Date.now()

  try {
    await git.pruneWorktrees(repoPath)

    TelemetryService.record({
      type: 'worktree_prune_attempted',
      success: true,
      durationMs: Date.now() - startTime
    })
  } catch (error) {
    TelemetryService.record({
      type: 'worktree_prune_attempted',
      success: false,
      error: error.message,
      durationMs: Date.now() - startTime
    })
    throw error
  }
}

// In retryWithPrune
TelemetryService.record({
  type: 'worktree_retry_triggered',
  operation: operationName,
  attempt: currentAttempt,
  maxAttempts: MAX_RETRY_ATTEMPTS
})
```

### Step 4: Add Developer Tools UI (2 hours)

```typescript
// src/web/components/DevTools/TelemetryPanel.tsx
function TelemetryPanel() {
  const stats = useTelemetryStats()
  const events = useTelemetryEvents({ limit: 50 })

  return (
    <div>
      <h3>Worktree Telemetry</h3>

      <StatsGrid>
        <Stat label="Events (last hour)" value={stats.eventsLastHour} />
        <Stat label="Prune Success Rate" value={`${stats.pruneSuccessRate}%`} />
        <Stat label="Stale Detections" value={stats.staleDetections} />
      </StatsGrid>

      <EventList events={events} />

      <Button onClick={handleExport}>Export for Support</Button>
    </div>
  )
}
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Memory usage with many events | Ring buffer caps at 1000 events |
| Disk persistence fails | Log warning, continue without persistence |
| Privacy (worktree paths) | Only store for local debugging, not sent externally |
