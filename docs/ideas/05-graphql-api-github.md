# Idea: Batch GraphQL API for GitHub

**Source:** `docs/future-improvements-status-checks.md`
**Status:** Proposed
**Priority:** Medium (after rate limit handling)
**Estimated Complexity:** Medium-High

## Problem

REST API requires multiple round trips:
```
1. GET /repos/{owner}/{repo}/pulls          -> List of PRs
2. GET /repos/{owner}/{repo}/pulls/{number} -> PR details (x N PRs)
3. GET /repos/{owner}/{repo}/commits/{ref}/check-runs -> Check runs (x N)
4. GET /repos/{owner}/{repo}/commits/{ref}/status     -> Commit status (x N)
```

For 10 open PRs = **31 API calls per refresh**.

## Proposed Solution

Use GitHub's GraphQL API to fetch all data in a single request:

```graphql
query GetPRsWithStatus($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 100, states: [OPEN, CLOSED, MERGED]) {
      nodes {
        number
        title
        state
        isDraft
        mergeable
        headRefName
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun { name, status, conclusion }
                    ... on StatusContext { context, state }
                  }
                }
              }
            }
          }
        }
        reviews(last: 10) {
          nodes { state, author { login } }
        }
      }
    }
  }
}
```

## Benefits

- **Single API call** instead of 31+
- **Reduced latency** (one round trip)
- **Better rate limit efficiency** (GraphQL has separate limit)
- **Fetch exactly needed fields**
- **Include review data** in same query

## Rate Limit Considerations

- REST: 5000 requests/hour
- GraphQL: 5000 points/hour (complex queries cost more)
- Need to calculate query cost and monitor usage

## Migration Strategy

1. Add GraphQL adapter alongside REST adapter
2. Feature flag to switch between them
3. Gradually migrate once stable
4. Keep REST as fallback

## Required Code Changes

1. Add GraphQL client (`graphql-request` or `@octokit/graphql`)
2. Create `GitHubGraphQLAdapter` implementing `GitForgeAdapter`
3. Add query cost tracking
4. Update type mappings for GraphQL response shape
5. Add feature flag for GraphQL vs REST

---

## Architecture Design Decision

### ADR-001: Adapter Pattern with Feature Flag

**Decision:** Create `GitHubGraphQLAdapter` implementing same interface as `GitHubRestAdapter`, controlled by feature flag.

**Rationale:**
- Same consumer code works with both adapters
- Easy A/B testing and rollback
- Can compare results between adapters during validation

**Alternatives Considered:**
1. **Replace REST entirely**: Rejected - too risky without validation period
2. **Hybrid (some calls GraphQL, some REST)**: Rejected - complicates rate limit tracking
3. **GraphQL only for new features**: Rejected - doesn't reduce existing API calls

### ADR-002: Query Cost Monitoring

**Decision:** Track GraphQL query cost and treat 1 point = 1 REST call for rate limit purposes.

**Rationale:**
- Unified rate limit handling between adapters
- GitHub GraphQL has 5000 points/hour (similar to REST)
- Complex queries cost more points, need to monitor

### ADR-003: Response Shape Normalization

**Decision:** Normalize GraphQL responses to match existing REST-based types before returning.

**Rationale:**
- No changes needed in consumers
- Type safety maintained
- Can swap adapters without touching UI/operations code

---

## First Implementation Steps

### Step 1: Add GraphQL Client (1 hour)

```typescript
// src/node/adapters/graphql/client.ts
import { GraphQLClient } from 'graphql-request'

export function createGitHubGraphQLClient(token: string): GraphQLClient {
  return new GraphQLClient('https://api.github.com/graphql', {
    headers: { Authorization: `Bearer ${token}` },
  })
}
```

### Step 2: Define Queries (2 hours)

```typescript
// src/node/adapters/graphql/queries.ts
export const GET_PRS_WITH_STATUS = gql`
  query GetPRsWithStatus($owner: String!, $repo: String!, $states: [PullRequestState!]) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 100, states: $states) {
        nodes {
          number, title, state, isDraft, mergeable, headRefName, baseRefName
          commits(last: 1) {
            nodes {
              commit {
                oid
                statusCheckRollup {
                  state
                  contexts(first: 100) {
                    nodes {
                      ... on CheckRun { __typename, name, status, conclusion, detailsUrl }
                      ... on StatusContext { __typename, context, state, targetUrl }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`
```

### Step 3: Create GraphQL Adapter (3 hours)

```typescript
// src/node/adapters/GitHubGraphQLAdapter.ts
export class GitHubGraphQLAdapter implements GitForgeAdapter {
  constructor(private client: GraphQLClient, private rateLimitService: RateLimitService) {}

  async getPullRequests(owner: string, repo: string): Promise<PullRequest[]> {
    const data = await this.client.request(GET_PRS_WITH_STATUS, { owner, repo, states: ['OPEN'] })
    return this.normalizePRs(data.repository.pullRequests.nodes)
  }

  private normalizePRs(nodes: GraphQLPRNode[]): PullRequest[] {
    return nodes.map(node => ({
      number: node.number,
      title: node.title,
      state: node.state.toLowerCase(),
      draft: node.isDraft,
      // ... map all fields to match REST types
    }))
  }
}
```

### Step 4: Add Feature Flag (30 min)

```typescript
// src/node/config/featureFlags.ts
export const FeatureFlags = {
  USE_GRAPHQL_API: process.env.TEAPOT_USE_GRAPHQL === 'true'
}

// src/node/adapters/index.ts
export function getGitHubAdapter(): GitForgeAdapter {
  return FeatureFlags.USE_GRAPHQL_API
    ? new GitHubGraphQLAdapter(client, rateLimitService)
    : new GitHubRestAdapter(rateLimitService)
}
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Query cost exceeds REST equivalent | Monitor and optimize query, paginate if needed |
| Different data shape causes bugs | Comprehensive normalization tests |
| GraphQL errors harder to debug | Log full GraphQL errors, add query tracing |
