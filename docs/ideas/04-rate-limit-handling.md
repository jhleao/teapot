# Idea: GitHub API Rate Limit Handling

**Source:** `docs/future-improvements-status-checks.md`
**Status:** Proposed
**Priority:** High (Do First per doc)
**Estimated Complexity:** Medium

## Problem

The app makes multiple GitHub API calls per refresh:
- 1 call to list PRs
- N calls to get PR details
- N calls to get check runs
- N calls to get commit statuses

For 10 open PRs = 31 API calls per refresh.

GitHub rate limit: 5000 requests/hour for authenticated users.
When limit is hit, API calls fail silently.

## Proposed Solution

Implement proactive rate limit detection and adaptive polling.

### 1. Track Rate Limit Headers

GitHub response headers provide:
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1372700873 (Unix timestamp)
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

### 2. Adaptive Polling Strategy

```typescript
function calculatePollInterval(state: RateLimitState): number {
  // Plenty of quota -> poll frequently (5s)
  if (state.remaining > state.limit * 0.5) return 5_000

  // Running low -> slow down (15s)
  if (state.remaining > state.limit * 0.2) return 15_000

  // Very low -> poll sparingly (1min)
  if (state.remaining > callsPerRefresh * 2) return 60_000

  // Nearly exhausted -> wait for reset
  return Math.max(timeUntilReset, 120_000)
}
```

### 3. Request Prioritization

When rate limited, prioritize:
1. PR list (basic UI)
2. Details for actively viewed PRs
3. Check runs for "ready to merge" PRs
4. Everything else

### 4. UI Feedback

- Show rate limit status in status bar
- Warn when approaching limit
- Show countdown to reset when exhausted

## Required Code Changes

1. Update `GitHubAdapter` to extract rate limit headers
2. Add `RateLimitService` to track state
3. Update `GitForgeClient` to adjust polling
4. Add rate limit indicator to UI
5. Implement request prioritization queue

## Benefits

- Prevents users from hitting API limits
- Improves reliability
- Better user feedback

---

## Architecture Design Decision

### ADR-001: Centralized Rate Limit Tracker

**Decision:** Create `RateLimitService` as single source of truth for rate limit state across all API clients.

**Rationale:**
- Different endpoints share the same rate limit pool
- Need to coordinate between PR fetcher, check fetcher, etc.
- Enables global throttling decisions

**Alternatives Considered:**
1. **Per-adapter tracking**: Rejected - can't coordinate across adapters
2. **Retry-after only**: Rejected - reactive, not proactive

### ADR-002: Adaptive Polling with Thresholds

**Decision:** Use percentage-based thresholds (50%, 20%, near-exhaustion) rather than fixed counts.

**Rationale:**
- Works regardless of user's actual limit (authenticated vs unauthenticated)
- Simple to reason about and tune
- Predictable behavior

### ADR-003: Header-Based Tracking

**Decision:** Extract rate limit info from response headers on every API call.

**Rationale:**
- Always up-to-date (reflects actual server state)
- No extra API calls needed
- Works with GitHub's bucket-based limits

---

## First Implementation Steps

### Step 1: Create Rate Limit Types (30 min)

```typescript
// src/node/services/RateLimitService.ts
interface RateLimitState {
  limit: number           // X-RateLimit-Limit
  remaining: number       // X-RateLimit-Remaining
  reset: number           // X-RateLimit-Reset (Unix timestamp)
  used: number            // X-RateLimit-Used
  resource: 'core' | 'search' | 'graphql'
  lastUpdated: number
}

interface RateLimitConfig {
  highThreshold: number   // 0.5 = 50% remaining
  lowThreshold: number    // 0.2 = 20% remaining
  criticalThreshold: number // 0.05 = 5% remaining
}
```

### Step 2: Implement Rate Limit Service (2 hours)

```typescript
export class RateLimitService {
  private state: Map<string, RateLimitState> = new Map()
  private config: RateLimitConfig = {
    highThreshold: 0.5,
    lowThreshold: 0.2,
    criticalThreshold: 0.05
  }

  updateFromHeaders(resource: string, headers: Headers): void {
    this.state.set(resource, {
      limit: parseInt(headers.get('X-RateLimit-Limit') || '5000'),
      remaining: parseInt(headers.get('X-RateLimit-Remaining') || '5000'),
      reset: parseInt(headers.get('X-RateLimit-Reset') || '0'),
      used: parseInt(headers.get('X-RateLimit-Used') || '0'),
      resource: resource as RateLimitState['resource'],
      lastUpdated: Date.now()
    })
  }

  getRecommendedPollInterval(): number {
    const core = this.state.get('core')
    if (!core) return 5_000 // Default

    const ratio = core.remaining / core.limit

    if (ratio > this.config.highThreshold) return 5_000      // Normal
    if (ratio > this.config.lowThreshold) return 15_000      // Slow down
    if (ratio > this.config.criticalThreshold) return 60_000 // Minimal

    // Exhausted - wait for reset
    const msUntilReset = (core.reset * 1000) - Date.now()
    return Math.max(msUntilReset, 120_000)
  }

  shouldThrottle(): boolean {
    const core = this.state.get('core')
    return core ? (core.remaining / core.limit) < this.config.criticalThreshold : false
  }
}
```

### Step 3: Integrate with GitHubAdapter (1 hour)

```typescript
// src/node/adapters/GitHubAdapter.ts
async fetch(url: string, options: RequestInit): Promise<Response> {
  if (rateLimitService.shouldThrottle()) {
    throw new RateLimitExceededError(rateLimitService.getTimeUntilReset())
  }

  const response = await fetch(url, options)

  // Update rate limit state from every response
  rateLimitService.updateFromHeaders('core', response.headers)

  return response
}
```

### Step 4: Add UI Indicator (1 hour)

```typescript
// src/web/components/StatusBar.tsx
function RateLimitIndicator() {
  const state = useRateLimitState()

  if (!state) return null

  const ratio = state.remaining / state.limit
  const color = ratio > 0.5 ? 'green' : ratio > 0.2 ? 'yellow' : 'red'

  return (
    <Tooltip content={`${state.remaining}/${state.limit} API calls remaining`}>
      <StatusDot color={color} />
    </Tooltip>
  )
}
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Stale rate limit data | Update on every response, expire after 1 minute |
| Multiple repos exhaust faster | Consider per-repo call budgets |
| User confusion about slowdown | Clear UI messaging about why polling slowed |
