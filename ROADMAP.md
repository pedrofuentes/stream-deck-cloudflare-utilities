# Roadmap — Stream Deck Cloudflare Utilities

> Created: February 20, 2026
> Current version: 1.0.1
> Current actions: 3 (Cloudflare Status, Worker Deployment Status, AI Gateway Metric)

This document outlines potential new actions, enhancements, and improvements based on what the Cloudflare API surface supports with read-only tokens.

---

## Current Token & API Surface

**Credentials stored**: API Token + Account ID (global settings, shared across actions)

**Token template**: Users are instructed to use the **"Read all resources"** template when creating their API token. This grants read-only access to all Cloudflare API resources, so every action below is already covered — no token changes needed.

**Currently used APIs:**

| API | Auth | Endpoints Used |
|---|---|---|
| Status Page (Atlassian) | None (public) | `/status.json`, `/components.json`, `/summary.json` |
| Workers Scripts | Bearer token | `GET /workers/scripts`, `GET .../deployments`, `GET .../versions` |
| AI Gateway (REST) | Bearer token | `GET /ai-gateway/gateways`, `GET .../logs?meta_info=true` |
| AI Gateway (GraphQL) | Bearer token | `aiGatewayRequestsAdaptiveGroups` |

---

## Priority Tiers

- **P0 — Quick Wins**: Extend existing actions or use APIs we already call (very low / low effort)
- **P1 — New Actions**: New buttons with new API services (medium effort)
- **P2 — Niche Actions**: Valuable for specific use cases, lower general demand
- **P3 — Infrastructure & Quality**: Non-feature improvements

---

## P0 — Quick Wins (Extend Existing)

### 0.1 · Worker Analytics Action

**What**: Show invocation count, error rate, CPU time, and duration for a selected Worker — similar to AI Gateway Metric but for Workers.

**Why**: The user already has Workers read access. Worker invocation stats are the #1 thing you want to see at a glance.

**API**: GraphQL `workersInvocationsAdaptive` — same GraphQL endpoint we already use for AI Gateway.

```graphql
query {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        filter: { scriptName: $scriptName, date_geq: $since }
        limit: 10000
      ) {
        sum { requests errors subrequests wallTime }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { status }
      }
    }
  }
}
```

**Metrics to cycle** (key press):
| Metric | Display | Example |
|---|---|---|
| Requests | Total invocations | `12.4K` |
| Errors | Error count + rate | `23 (0.2%)` |
| CPU P50 | Median CPU time | `2.3ms` |
| CPU P99 | P99 CPU time | `45ms` |
| Wall Time | Avg duration | `120ms` |
| Subrequests | Total subrequests | `8.1K` |

**Effort**: Medium — reuse key renderer, marquee, adaptive polling, and generation counter from AI Gateway Metric. New service + types + action + tests.

---

### 0.2 · Cloudflare Status — Component Drill-Down

**What**: Allow the user to pick a specific Cloudflare component (CDN/Cache, DNS, Workers, Pages, etc.) instead of only showing the overall status.

**Why**: "All Systems Operational" is useless when DNS is degraded but everything else is fine. The `getComponents()` method already exists but isn't exposed to the user.

**API**: Already implemented — `CloudflareApiClient.getComponents()`.

**UI Change**: Add a dropdown in the PI to select a component (or "Overall" for current behavior). The dropdown populates from the components API.

**Effort**: Low — the API call exists, just needs PI dropdown + action setting + conditional rendering.

---

### 0.3 · AI Gateway Metric — Error Rate Instead of Raw Count

**What**: Add an "Error Rate" metric (errors / requests × 100) to the cycle order.

**Why**: Raw error count is less useful than error percentage. "23 errors" means nothing without knowing total requests.

**API**: No new calls — compute from existing `errors` and `requests` fields.

**Effort**: Very low — add `error_rate` to the metric type, compute in the action, add to cycle order.

---

### 0.4 · AI Gateway Metric — Cache Hit Rate

**What**: Show cache hit ratio using `cachedTokensIn + cachedTokensOut` vs total tokens.

**Why**: Knowing your AI Gateway cache hit rate directly impacts cost. Already available in the GraphQL response.

**API**: Already fetched — `cachedTokensIn`, `cachedTokensOut`, `uncachedTokensIn`, `uncachedTokensOut`.

**Effort**: Very low — new computed metric from existing data.

---

## P1 — New Actions

### 1.1 · Pages Deployment Status

**What**: Monitor the latest deployment of a Cloudflare Pages project. Show status (success/failed/building), time ago, branch, and commit message.

**Why**: Pages is the other major deployment target alongside Workers. Many users have both.

**API**:
```
GET /accounts/{account_id}/pages/projects                         → list projects
GET /accounts/{account_id}/pages/projects/{name}/deployments      → list deployments
```

**Key display**:
```
┌════════════════════════┐  green = success, yellow = building, red = failed
│     my-site (18px)     │
│      3m ago (30px)     │
│   main • abc123 (15px) │
└────────────────────────┘
```

**Effort**: Medium — very similar to Worker Deployment Status. Reuse most of the architecture.

---

### 1.2 · DNS Record Monitor

**What**: Monitor a specific DNS record (A, AAAA, CNAME, TXT) and display its value + proxy status. Show warning if the record disappears or changes unexpectedly.

**Why**: Useful for monitoring critical DNS records (apex domain, MX records, verification TXT records).

**API**:
```
GET /zones/{zone_id}/dns_records?name={record_name}&type={type}
```

**Key display**:
```
┌════════════════════════┐  green = proxied, blue = DNS-only, red = missing
│    example.com (18px)  │
│    1.2.3.4 (30px)      │
│    A • proxied (15px)  │
└────────────────────────┘
```

**Global settings change**: Would need Zone ID — either auto-detect from zone list or add to setup.

**Effort**: Medium — new service, new types, new PI with zone/record selection.

---

### 1.3 · Zone Analytics Action

**What**: Show analytics for a zone — total requests, bandwidth, threats blocked, unique visitors.

**Why**: The "big picture" dashboard metric. Useful for site owners who want a glanceable traffic counter.

**API**: GraphQL `httpRequestsAdaptiveGroups`:
```graphql
query {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        filter: { date_geq: $since }
        limit: 1
      ) {
        count
        sum { bytes cachedBytes threats edgeResponseBytes }
        uniq { uniques }
      }
    }
  }
}
```

**Metrics to cycle**:
| Metric | Display | Example |
|---|---|---|
| Requests | Total HTTP requests | `1.2M` |
| Bandwidth | Total bandwidth | `4.5GB` |
| Cache Rate | Cached / total bytes | `92%` |
| Threats | Threats blocked | `342` |
| Visitors | Unique visitors | `45.2K` |

**Global settings**: Would need Zone ID selection — add zone dropdown to setup.

**Effort**: Medium-High — new service, types, PI zone selector, new action. But metric cycling architecture can be fully reused.

---

### 1.4 · R2 Storage Metric

**What**: Show R2 bucket storage metrics — object count, storage used, operations count.

**Why**: R2 is increasingly popular. Storage usage and operation counts help monitor cost.

**API**:
```
GET /accounts/{account_id}/r2/buckets                    → list buckets
```
GraphQL `r2StorageAdaptiveGroups`:
```graphql
query {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(
        filter: { bucketName: $bucket, date_geq: $since }
        limit: 1
      ) {
        max { objectCount payloadSize metadataSize }
      }
    }
  }
}
```

**Metrics to cycle**:
| Metric | Display | Example |
|---|---|---|
| Objects | Total objects | `12.4K` |
| Storage | Total payload size | `2.3GB` |
| Operations | Class A + B ops | `45K` |

**Effort**: Medium — new service, similar structure to AI Gateway.

---

### 1.5 · D1 Database Metric

**What**: Show D1 database analytics — rows read, rows written, database size.

**Why**: D1 is Cloudflare's serverless SQL database. Monitoring reads/writes helps track usage against free-tier limits.

**API**: GraphQL `d1AnalyticsAdaptiveGroups`:
```graphql
query {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        filter: { databaseId: $dbId, date_geq: $since }
        limit: 1
      ) {
        sum { readQueries writeQueries rowsRead rowsWritten }
        max { databaseSizeBytes }
      }
    }
  }
}
```

**Effort**: Medium — very similar to AI Gateway Metric.

---

### 1.6 · KV Namespace Metric

**What**: Show Workers KV analytics — reads, writes, deletes, list operations.

**Why**: KV is widely used for edge state. Read/write counts help monitor usage patterns.

**API**: GraphQL `workersKvStorageAdaptiveGroups`:
```graphql
query {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersKvStorageAdaptiveGroups(
        filter: { namespaceId: $nsId, date_geq: $since }
        limit: 1
      ) {
        sum { readQueries writeQueries deleteQueries listQueries }
      }
    }
  }
}
```

**Effort**: Medium.

---

## P2 — Niche Actions

### 2.1 · Firewall / WAF Events

**What**: Show count of firewall events (blocked, challenged, JS challenged) for a zone.

**Why**: Security monitoring at a glance — know when you're under attack.

**API**: GraphQL `firewallEventsAdaptiveGroups`:
```graphql
query {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      firewallEventsAdaptiveGroups(
        filter: { date_geq: $since }
        limit: 5
      ) {
        count
        dimensions { action }
      }
    }
  }
}
```

**Metrics**: Total events, Blocked, Challenged, JS Challenged, Managed Rule hits.

**Effort**: Medium.

---

### 2.2 · Queue Depth Monitor

**What**: Monitor a Cloudflare Queue's message backlog and consumer status.

**Why**: Queue depth is a critical operational metric — a growing backlog = problems.

**API**:
```
GET /accounts/{account_id}/queues                         → list queues
GET /accounts/{account_id}/queues/{queue_id}              → queue details
```

**Key display**:
```
┌════════════════════════┐  green = healthy, yellow = backlog growing, red = stalled
│    my-queue (18px)     │
│      1.2K msgs (30px)  │
│    2 consumers (15px)  │
└────────────────────────┘
```

**Effort**: Medium.

---

### 2.3 · Stream (Video) Analytics

**What**: Show Cloudflare Stream video analytics — total minutes watched, views, storage used.

**Why**: Niche but high-value for users who use Cloudflare Stream.

**API**: GraphQL + REST endpoints for Stream.

**Effort**: Medium.

---

### 2.4 · SSL Certificate Expiry Monitor

**What**: Show days until SSL certificate expiry for a zone. Accent bar transitions from green → yellow → red as expiry approaches.

**Why**: Certificate expiry is a common outage cause. Glanceable countdown is valuable.

**API**:
```
GET /zones/{zone_id}/ssl/certificate_packs
```

**Key display**:
```
┌════════════════════════┐  green = >30d, yellow = <30d, red = <7d
│   example.com (18px)   │
│      42 days (30px)    │
│   SSL expires (15px)   │
└────────────────────────┘
```

**Effort**: Low — simple API call, straightforward display.

---

### 2.5 · Waiting Room Status

**What**: Show current status of a Cloudflare Waiting Room — active users in queue, estimated wait time.

**Why**: For sites using Waiting Rooms during high traffic events.

**API**:
```
GET /zones/{zone_id}/waiting_rooms/{id}/status
```

**Effort**: Low-Medium.

---

## P3 — Infrastructure & Quality Improvements

### 3.1 · Multi-Action Profiles

**What**: Pre-configured Stream Deck profiles with recommended layouts. Share as `.streamDeckProfile` files.

**Why**: New users don't know what to put where. A "Cloudflare DevOps" profile with pre-configured buttons is a great onboarding.

**Effort**: Low — just profile configuration files + documentation.

---

### 3.2 · Token Validation in Setup

**What**: When the user enters their API token in the setup window, validate it by calling `GET /user/tokens/verify` and show a green checkmark or red error with the specific missing permission.

**API**:
```
GET /user/tokens/verify   → { success: true, result: { status: "active" } }
```

**Why**: Currently, the user finds out their token is bad only when an action fails. Upfront validation is much better UX.

**Effort**: Low — one API call + UI feedback in `setup.html`.

---

### 3.3 · Permission Detection & Action Gating

**What**: After token validation, detect which permissions the token has and grey out / show info icons on actions that require additional permissions.

**Why**: Prevents confusion when a user doesn't have `R2:Read` but tries to configure an R2 Metric action.

**API**: `GET /user/tokens/verify` returns the token's policies. Parse them to determine available permissions.

**Effort**: Medium — requires mapping API permissions to action requirements.

---

### 3.4 · Notification / Alert Thresholds

**What**: Add configurable thresholds to any metric action. When a value crosses the threshold, flash the accent bar red or show a visual alert.

**Example**: "If Worker error rate > 5%, flash red." "If AI Gateway cost > $10/day, show warning."

**UI**: Add threshold fields to each action's PI (optional, off by default).

**Effort**: Medium — cross-cutting concern, needs to work with all metric actions.

---

### 3.5 · Long-Press for Action URL

**What**: Long-press a key to open the corresponding Cloudflare dashboard page in the browser.

**Example**: Press Worker Deployment Status → opens `https://dash.cloudflare.com/{account}/workers/services/view/{worker}`.

**API**: `openUrl()` from the Stream Deck SDK.

**Effort**: Low — `onKeyDown` with timer to detect long-press, construct URL from settings.

---

### 3.6 · Localized Time Formats

**What**: Support user-preferred time formats (12h/24h, relative vs absolute).

**Effort**: Very low — add a global setting.

---

### 3.7 · Dark / Light Theme Support

**What**: Detect Stream Deck software theme and adjust the background/text colors of the SVG accordingly.

**Effort**: Low-Medium — the SVG renderer already centralizes colors. Would need theme detection.

---

## Recommended Rollout Order

Based on value and effort:

| Version | Items | Theme |
|---|---|---|
| **v1.1** | 0.1 (Worker Analytics), 0.2 (Component Drill-Down), 0.3 (Error Rate), 0.4 (Cache Hit Rate) | Enhance existing + Worker analytics |
| **v1.2** | 3.2 (Token Validation), 3.5 (Long-Press URL), 1.1 (Pages Deployment) | UX polish + Pages |
| **v1.3** | 1.3 (Zone Analytics), 1.2 (DNS Monitor), 2.4 (SSL Expiry) | Zone-level monitoring |
| **v1.4** | 1.4 (R2 Metric), 1.5 (D1 Metric), 1.6 (KV Metric) | Storage & database monitoring |
| **v2.0** | 3.3 (Permission Detection), 3.4 (Alert Thresholds), 2.1 (WAF Events) | Smart alerting + security |

---

## API Permissions Reference

All actions are covered by the **"Read all resources"** token template. This table lists which specific API permissions each action uses for reference:

| Action | API Permissions Used |
|---|---|
| Cloudflare Status | None (public API) |
| Worker Deployment | Workers Scripts:Read |
| Worker Analytics | Account Analytics:Read |
| AI Gateway Metric | AI Gateway:Read, Account Analytics:Read |
| Pages Deployment | Pages:Read |
| Zone Analytics | Zone:Read, Zone Analytics:Read |
| DNS Monitor | Zone:Read, DNS:Read |
| R2 Metric | R2:Read, Account Analytics:Read |
| D1 Metric | D1:Read, Account Analytics:Read |
| KV Metric | Workers KV Storage:Read, Account Analytics:Read |
| SSL Expiry | Zone:Read, SSL and Certificates:Read |
| Firewall Events | Zone:Read, Firewall Services:Read |
| Queue Depth | Queues:Read |
| Token Validation | User API Tokens:Read |

> **Note**: This plugin only uses **read-only** permissions. It never writes, deletes, or modifies any Cloudflare resource.
