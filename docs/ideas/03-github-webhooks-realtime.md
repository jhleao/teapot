# Idea: GitHub Webhooks for Real-Time Updates

**Source:** `docs/future-improvements-status-checks.md`
**Status:** Proposed
**Priority:** Low (requires significant infrastructure)
**Estimated Complexity:** High

## Problem

The app polls GitHub every 5 seconds to check for PR status changes:
- Unnecessary API calls when nothing has changed
- Up to 5-second delay in seeing status updates
- Wastes rate limit quota

## Proposed Solution

Use GitHub webhooks to receive push notifications for:
- `check_run` event - Check runs start/complete
- `pull_request` event - PR status changes
- `status` event - Commit status updates

## Architecture Options

### Option A: Local Webhook Server (Recommended for Electron)

```
GitHub -> ngrok/localtunnel -> Local Express server -> IPC -> Renderer
```

- Run lightweight HTTP server in main process
- Use tunneling service to expose it
- User configures webhook URL in GitHub repo settings

**Pros:** No external infrastructure
**Cons:** Requires tunnel setup, reliability issues

### Option B: Cloud Relay Service

```
GitHub -> Cloud Function -> WebSocket -> Electron App
```

- Deploy serverless function (AWS Lambda, Cloudflare Worker)
- App maintains WebSocket connection

**Pros:** More reliable, works behind firewalls
**Cons:** Requires cloud infrastructure

### Option C: GitHub App

```
GitHub -> GitHub App webhook endpoint -> Push notification -> App
```

- Create GitHub App instead of PAT
- Better permission model

**Pros:** Official approach
**Cons:** Requires server, complex setup

## Security Requirements

- Validate webhook signatures using `X-Hub-Signature-256`
- Use HTTPS for endpoints
- Implement secret rotation
- Rate limit incoming requests

## Required Code Changes

1. Add `WebhookService.ts` to main process
2. Add event handlers for check_run, pull_request, status
3. Integrate with ForgeStateContext
4. Add webhook configuration UI
5. Add tunnel/connection management
6. Fallback to polling if webhook connection fails

## User Experience

- Provide setup wizard for configuration
- Show connection status in UI
- Allow manual refresh
- Graceful fallback to polling

---

## Architecture Design Decision

### ADR-001: Cloud Relay as Primary Architecture

**Decision:** Implement Option B (Cloud Relay Service) as the primary architecture, with polling as fallback.

**Rationale:**
- Works behind corporate firewalls and NAT
- No user configuration required (no webhook URL setup)
- More reliable than tunneling solutions
- Can be gradually rolled out with feature flag

**Alternatives Considered:**
1. **Local webhook server with ngrok**: Rejected - requires user to set up tunnel, unreliable
2. **GitHub App**: Rejected - requires server infrastructure, complex OAuth flow
3. **Polling only**: Current state - misses real-time updates, wastes API quota

### ADR-002: Hybrid Polling + WebSocket

**Decision:** Maintain polling as fallback, with WebSocket for real-time updates when connected.

**Rationale:**
- Graceful degradation when relay is unavailable
- Can validate webhook data against polling data
- Smooth transition from current architecture

---

## First Implementation Steps

### Step 1: Design Relay Protocol (2 hours)

```typescript
// Message types between app and relay
interface RelayMessage {
  type: 'subscribe' | 'unsubscribe' | 'event' | 'ping' | 'pong'
}

interface SubscribeMessage extends RelayMessage {
  type: 'subscribe'
  repos: Array<{ owner: string; repo: string }>
  token: string // For relay to register with GitHub
}

interface GitHubEventMessage extends RelayMessage {
  type: 'event'
  event: 'check_run' | 'pull_request' | 'status'
  repo: { owner: string; repo: string }
  payload: unknown
}
```

### Step 2: Implement WebSocket Client (4 hours)

```typescript
// src/node/services/WebhookRelayService.ts
export class WebhookRelayService {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0

  async connect(repos: RepoInfo[]): Promise<void> {
    this.ws = new WebSocket(RELAY_URL)

    this.ws.on('open', () => {
      this.send({ type: 'subscribe', repos, token: this.getToken() })
      this.reconnectAttempts = 0
    })

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as RelayMessage
      if (msg.type === 'event') {
        this.handleEvent(msg as GitHubEventMessage)
      }
    })

    this.ws.on('close', () => this.scheduleReconnect())
  }

  private handleEvent(msg: GitHubEventMessage): void {
    // Dispatch to ForgeStateContext
    forgeStateContext.handleWebhookEvent(msg.event, msg.payload)
  }
}
```

### Step 3: Integrate with ForgeStateContext (2 hours)

```typescript
// src/node/contexts/ForgeStateContext.ts
handleWebhookEvent(event: string, payload: unknown): void {
  switch (event) {
    case 'check_run':
      this.updateCheckRun(payload as CheckRunPayload)
      break
    case 'pull_request':
      this.updatePullRequest(payload as PRPayload)
      break
    case 'status':
      this.updateCommitStatus(payload as StatusPayload)
      break
  }
  this.notifySubscribers()
}
```

### Step 4: Deploy Relay Service (separate project)

Minimal Cloudflare Worker:
```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === 'websocket') {
      return handleWebSocket(request)
    }
    // GitHub webhook endpoint
    if (request.method === 'POST') {
      return handleGitHubWebhook(request)
    }
  }
}
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Relay service downtime | Automatic fallback to polling |
| Message ordering | Include sequence numbers, reconcile with poll |
| Security (token exposure) | Use short-lived tokens, validate signatures |
| Cost | Cloudflare Workers free tier handles low volume |
