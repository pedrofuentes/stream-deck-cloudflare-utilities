# Architecture

> Extended architectural context for AI agents. Referenced from AGENTS.md.

---

## Project Structure

```
stream-deck-cloudflare-utilities/
├── src/
│   ├── actions/          ← One file per Stream Deck action (extends SingletonAction)
│   ├── services/         ← API clients & business logic — NO @elgato/streamdeck import
│   ├── types/            ← Shared TypeScript interfaces (excluded from coverage)
│   └── plugin.ts         ← Entry point: registers actions, connects to Stream Deck
├── tests/                ← Mirrors src/ (actions/, services/, scripts/, types/)
├── plugin/               ← Plugin source assets (tracked in git)
│   ├── imgs/             ← Action/category icons (SVG + PNG)
│   ├── ui/               ← Property Inspector HTML (+ shared setup.html)
│   ├── manifest.json     ← Plugin manifest (UUID, actions, states)
│   └── .sdignore         ← Packaging exclusions
├── scripts/              ← Build/validation (validate-consistency.ts, convert-content-assets.ts)
├── content/              ← Elgato Marketplace content (see content/CONTENT-GUIDE.md)
├── docs/                 ← Agent companion docs (this file, SENTINEL.md, …)
├── .github/              ← UI-DESIGN-GUIDE.md, TESTING-PROTOCOL.md (hardware-tested guides)
├── release/              ← Build output (gitignored)
└── dist/                 ← Packaged .streamDeckPlugin (gitignored)
```

## Layered Architecture

| Layer | Location | Rule |
|-------|----------|------|
| Actions | `src/actions/` | Extend `SingletonAction<TSettings>`. UI + event wiring only. May import services. |
| Services | `src/services/` | Plain classes/functions. **No `@elgato/streamdeck` import** → unit-testable in isolation. |
| Types | `src/types/` | Shared interfaces + per-action settings/metric enums. No logic. |
| Entry | `src/plugin.ts` | Registers actions and connects. Kept minimal; excluded from coverage. |

Shared cross-action services: `key-image-renderer` (SVG → key image), `marquee-controller`
(scrolling long names), `polling-coordinator` (adaptive polling), `global-settings-store`
(credentials pub/sub).

### UUID convention
- Plugin: `com.pedrofuentes.cloudflare-utilities`
- Actions: `com.pedrofuentes.cloudflare-utilities.<action-name>`

## Code Patterns

**Good — API/business logic lives in a service with no Stream Deck dependency:**
```typescript
// src/services/cloudflare-api-client.ts
export class CloudflareApiClient {
  constructor(private baseUrl: string = CLOUDFLARE_STATUS_API) {}

  async getSystemStatus(): Promise<CloudflareSystemStatus> {
    const response = await fetch(`${this.baseUrl}/status.json`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Cloudflare status: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as CloudflareStatusApiResponse;
    return /* mapped domain object */;
  }
}
```
The service imports only `../types/*`, so tests mock `fetch` with `vi.stubGlobal` and never
load the SDK.

**Bad — fetching/parsing inside the action, coupling network logic to the SDK:**
```typescript
@action({ UUID: "…cloudflare-utilities.status" })
export class StatusAction extends SingletonAction {
  async onWillAppear(ev: WillAppearEvent) {
    const res = await fetch("https://…/status.json");          // ✗ untestable without the SDK
    ev.action.setTitle((await res.json()).status.indicator);   // ✗ setTitle alone; no service layer
  }
}
```
Actions render via `setImage` using the shared renderer; all I/O goes through a service.

## Cloudflare API Integration

These rules come from production failures — follow them for **every** new or modified API call.

### GraphQL dataset & field names are NOT guessable
Cloudflare's GraphQL Analytics datasets are inconsistently documented and cannot be inferred
from product names. Validated datasets in use:

| Dataset | Use | Notes |
|---------|-----|-------|
| `httpRequests1dGroups` | Zone HTTP analytics | NOT `httpRequestsAdaptiveGroups` for bytes/threats |
| `d1AnalyticsAdaptiveGroups` | D1 query analytics | `sum` only — NO `max` aggregation |
| `r2StorageAdaptiveGroups` | R2 storage metrics | has `max` |
| `r2OperationsAdaptiveGroups` | R2 operation counts | |
| `kvOperationsAdaptiveGroups` | KV ops by `actionType` | `sum { requests }` + `dimensions { actionType }`; `workersKvStorageAdaptiveGroups` does NOT exist |
| `workersInvocationsAdaptive` (REST) | Worker analytics | Workers analytics is REST, not GraphQL |

Fields and aggregations differ per dataset (`sum` vs `max`, `requests` vs `readQueries`).
**Verify any new query against the live API before committing;** otherwise reuse only fields
confirmed in existing services. Prefer REST when a dataset/field is uncertain (e.g., D1 size
via `/d1/database/{id}` → `file_size`). See ADR-002.

### Status API endpoint
The status client uses the Atlassian Statuspage endpoint
`https://yh6f0r4529hb.statuspage.io/api/v2` (public, no auth). The branded
`www.cloudflarestatus.com` domain sits behind CloudFront and returns 403 to programmatic
requests. See ADR-001.

### Display names vs IDs
Each action's Property Inspector saves both an ID and a display name (`databaseId` +
`databaseName`, `zoneId` + `zoneName`, …). Action code adds the `…Name?: string` setting,
uses `settings.displayName ?? settings.resourceId` everywhere (line 1, marquee, error state),
and tracks `lastDisplayName` for cached renders.

### Rate limiting
HTTP 429 is handled with graceful backoff via `RateLimitError` in
`cloudflare-ai-gateway-api.ts`.

## Global Settings Architecture

API credentials (API Token, Account ID) are shared across all actions through Stream Deck
global settings — never via `.env` or hard-coding. See ADR-004.

1. `src/services/global-settings-store.ts` — in-memory store with pub/sub; actions subscribe
   via `onGlobalSettingsChanged()`.
2. `src/plugin.ts` — loads global settings on startup, listens via `onDidReceiveGlobalSettings`.
3. `plugin/ui/setup.html` — shared setup window opened from any PI; reads/writes via
   `$SD.getGlobalSettings()` / `$SD.setGlobalSettings()`.
4. Each action re-initializes when credentials change.

To add a field: update the `GlobalSettings` type, add an input to `setup.html`; actions pick
it up automatically through the pub/sub system.

## Key Technical Decisions

Recorded as ADRs in [`../DECISIONS.md`](../DECISIONS.md). Highlights: Statuspage endpoint over
the branded domain (ADR-001), REST-over-GraphQL when uncertain (ADR-002), `vite` pinned via
package overrides for the TC39 decorator transform (ADR-003), global-settings pub/sub for
shared credentials (ADR-004).

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | Registers all actions, connects to Stream Deck |
| `src/services/key-image-renderer.ts` | SVG → key image (accent bar, line layout, colors, truncation constants) |
| `src/services/global-settings-store.ts` | Credentials store + pub/sub |
| `src/services/polling-coordinator.ts` | Adaptive polling shared across actions |
| `src/services/marquee-controller.ts` | Scrolling animation for names > 10 chars |
| `plugin/manifest.json` | Plugin + action definitions (UUIDs, states) |
| `scripts/validate-consistency.ts` | Verifies actions/manifest/PI/icons/tests/docs are in sync |

## Further Reading
- UI / key rendering: [`../.github/UI-DESIGN-GUIDE.md`](../.github/UI-DESIGN-GUIDE.md) + [`../SKILLS.md`](../SKILLS.md)
- Testing details: [`./TESTING-STRATEGY.md`](./TESTING-STRATEGY.md) + [`../.github/TESTING-PROTOCOL.md`](../.github/TESTING-PROTOCOL.md)
- Adding an action/service: [`./DEVELOPMENT-WORKFLOW.md`](./DEVELOPMENT-WORKFLOW.md)
