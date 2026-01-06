# Future Improvements: Status Checks System

This document outlines potential improvements to the PR status checks implementation that are planned for future versions. These require additional infrastructure or significant architectural changes.

## 1. GitHub Webhooks for Real-Time Updates

### Current State
The app polls GitHub every 5 seconds to check for PR status changes. This creates:
- Unnecessary API calls when nothing has changed
- Up to 5-second delay in seeing status updates
- Wasted rate limit quota

### Proposed Solution
Use GitHub webhooks to receive push notifications when:
- Check runs start/complete (`check_run` event)
- PR status changes (`pull_request` event)
- Commit statuses update (`status` event)

### Implementation Considerations

#### Architecture Options

**Option A: Local Webhook Server (Recommended for Electron)**
```
GitHub → ngrok/localtunnel → Local Express server → IPC → Renderer
```
- Run a lightweight HTTP server in the main process
- Use a tunneling service (ngrok, localtunnel) to expose it
- User configures webhook URL in GitHub repo settings
- Pros: No external infrastructure needed
- Cons: Requires tunnel setup, may have reliability issues

**Option B: Cloud Relay Service**
```
GitHub → Cloud Function → WebSocket → Electron App
```
- Deploy a serverless function (AWS Lambda, Cloudflare Worker)
- GitHub sends webhooks to the cloud function
- App maintains WebSocket connection to receive events
- Pros: More reliable, works behind firewalls
- Cons: Requires cloud infrastructure, adds latency

**Option C: GitHub App with Installation**
```
GitHub → GitHub App webhook endpoint → Push notification → App
```
- Create a GitHub App instead of using PAT
- App server receives webhooks and pushes to clients
- Pros: Better permission model, official approach
- Cons: Requires running a server, complex setup

#### Security Considerations
- Validate webhook signatures using `X-Hub-Signature-256` header
- Use HTTPS for webhook endpoints
- Implement webhook secret rotation
- Rate limit incoming webhook requests

#### User Experience
- Provide setup wizard for webhook configuration
- Show connection status in the UI
- Fall back to polling if webhook connection fails
- Allow users to manually trigger refresh

#### Code Changes Required
1. Add webhook server to main process (`src/node/services/WebhookService.ts`)
2. Add webhook event handlers for check_run, pull_request, status events
3. Integrate with ForgeStateContext to update state on webhook events
4. Add UI for webhook configuration in settings
5. Add tunnel/connection management

### Estimated Complexity: High
Requires new infrastructure, security considerations, and significant code changes.

---

## 2. Rate Limit Handling

### Current State
The app makes multiple GitHub API calls per refresh:
- 1 call to list PRs
- N calls to get PR details (one per open PR)
- N calls to get check runs (one per open PR)
- N calls to get commit statuses (one per open PR)

If the user hits the GitHub rate limit (5000 requests/hour for authenticated users), API calls fail silently.

### Proposed Solution
Implement proactive rate limit detection and adaptive polling.

### Implementation Details

#### 1. Track Rate Limit Headers
GitHub returns rate limit info in response headers:
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1372700873 (Unix timestamp)
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

#### 2. Adaptive Polling Strategy
```typescript
type RateLimitState = {
  remaining: number
  resetAt: number
  limit: number
}

function calculatePollInterval(state: RateLimitState): number {
  const timeUntilReset = state.resetAt - Date.now()
  const callsPerRefresh = estimateCallsPerRefresh()

  // If we have plenty of quota, poll frequently
  if (state.remaining > state.limit * 0.5) {
    return 5_000 // 5 seconds
  }

  // If running low, slow down
  if (state.remaining > state.limit * 0.2) {
    return 15_000 // 15 seconds
  }

  // If very low, only poll when necessary
  if (state.remaining > callsPerRefresh * 2) {
    return 60_000 // 1 minute
  }

  // If nearly exhausted, wait for reset
  return Math.max(timeUntilReset, 120_000)
}
```

#### 3. UI Feedback
- Show rate limit status in the status bar
- Warn users when approaching limit
- Show countdown to rate limit reset when exhausted

#### 4. Request Prioritization
When rate limited, prioritize:
1. PR list (most important for basic UI)
2. Details for PRs user is actively viewing
3. Check runs for PRs marked as "ready to merge"
4. Everything else

### Code Changes Required
1. Update `GitHubAdapter` to extract and return rate limit headers
2. Add `RateLimitService` to track state across requests
3. Update `GitForgeClient` to adjust polling based on rate limit
4. Add rate limit indicator to UI
5. Implement request prioritization queue

### Estimated Complexity: Medium
Mostly additive changes, no architectural overhaul needed.

---

## 3. Batch GraphQL API

### Current State
The REST API requires multiple round trips:
```
1. GET /repos/{owner}/{repo}/pulls → List of PRs
2. GET /repos/{owner}/{repo}/pulls/{number} → PR details (x N PRs)
3. GET /repos/{owner}/{repo}/commits/{ref}/check-runs → Check runs (x N PRs)
4. GET /repos/{owner}/{repo}/commits/{ref}/status → Commit status (x N PRs)
```

For 10 open PRs, this is 31 API calls per refresh.

### Proposed Solution
Use GitHub's GraphQL API to fetch all data in a single request.

### GraphQL Query Example
```graphql
query GetPRsWithStatus($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 100, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        state
        isDraft
        mergeable
        mergeStateStatus
        headRefName
        headRefOid
        baseRefName
        createdAt
        mergedAt

        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                      description
                    }
                  }
                }
              }
            }
          }
        }

        reviews(last: 10) {
          nodes {
            state
            author {
              login
            }
          }
        }
      }
    }
  }
}
```

### Benefits
- Single API call instead of 31+ calls
- Reduced latency (one round trip vs many)
- Better rate limit efficiency (GraphQL has separate 5000 points/hour limit)
- Can fetch exactly the fields needed
- Can include review data in same query

### Implementation Considerations

#### GraphQL vs REST Rate Limits
- REST: 5000 requests/hour
- GraphQL: 5000 points/hour, but complex queries cost more points
- Need to calculate query cost and monitor usage

#### Query Complexity
GitHub limits query complexity. May need to:
- Paginate large result sets
- Split into multiple queries for repos with many PRs
- Use query cost estimation

#### Migration Strategy
1. Add GraphQL adapter alongside REST adapter
2. Feature flag to switch between them
3. Gradually migrate once stable
4. Keep REST as fallback

### Code Changes Required
1. Add GraphQL client (e.g., `graphql-request` or `@octokit/graphql`)
2. Create `GitHubGraphQLAdapter` implementing `GitForgeAdapter`
3. Add query cost tracking
4. Update type mappings for GraphQL response shape
5. Add feature flag for GraphQL vs REST

### Estimated Complexity: Medium-High
New API paradigm, but mostly isolated to the adapter layer.

---

## Implementation Priority

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Rate Limit Handling | Medium | Medium | 1 (Do First) |
| Batch GraphQL | High | Medium-High | 2 |
| Webhooks | High | High | 3 (Do Last) |

**Rationale:**
1. Rate limit handling prevents users from hitting API limits and improves reliability
2. GraphQL reduces API calls significantly, improving performance and rate limit usage
3. Webhooks are nice-to-have but require significant infrastructure work

---

## References

- [GitHub REST API Rate Limiting](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [GitHub Webhooks](https://docs.github.com/en/webhooks)
- [GitHub Check Runs API](https://docs.github.com/en/rest/checks/runs)
- [GitHub Commit Status API](https://docs.github.com/en/rest/commits/statuses)
