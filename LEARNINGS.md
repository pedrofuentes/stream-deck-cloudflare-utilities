# Learnings — Stream Deck Cloudflare Utilities

> **This file is written by AI agents.** When you discover something about this project
> that isn't documented elsewhere, add it here. Do NOT write to AGENTS.md.
>
> Periodically, a human or agent should review this file and promote stable learnings
> into the appropriate companion doc (ARCHITECTURE.md, TESTING-STRATEGY.md, etc.).

## Format

```markdown
### [YYYY-MM-DD] Short description
**Context**: What were you doing when you discovered this?
**Learning**: What did you learn?
**Impact**: How should this affect future work?
```

## Learnings

<!-- Add new learnings below this line, most recent first -->

### [2026-07-29] SingletonAction state is shared across physical keys
**Context**: Fixing multi-account tokens so separate keys can select different Cloudflare accounts.
**Learning**: The SDK creates one `SingletonAction` instance per action type, not per physical key.
Instance fields, static polling subscriber IDs, account-agnostic caches, and unresolved asynchronous
requests can therefore overwrite or render another key's state.
**Impact**: Isolate mutable authenticated-action state by `action.id`; include the key/account in
polling IDs and caches; clean up on `onWillDisappear`; increment a generation when settings change
so responses started under an old account are discarded.

### [2026-07-29] Account scope belongs with the selected resource
**Context**: Migrating from one global Cloudflare Account ID to multi-account key configuration.
**Learning**: The API token is shared authentication, but the account is part of a key's resource
scope. A global account cannot represent Workers, zones, buckets, databases, namespaces, projects,
and gateways selected independently across keys.
**Impact**: Keep the token and refresh interval global; persist `accountId` and `accountName` per
key; clear its resource when the account changes. Use a legacy global account only to migrate an
already-configured key, never to preselect a new key.

### [2026-06-16] Cloudflare GraphQL dataset/field names are not guessable
**Context**: Adding analytics actions (Zone, R2, D1, KV).
**Learning**: Dataset names (e.g., `kvOperationsAdaptiveGroups`, NOT `workersKvStorageAdaptiveGroups`)
and per-dataset aggregations (`sum` vs `max`) cannot be inferred from product names; some assumed
REST endpoints (`/storage/analytics`) don't exist.
**Impact**: Verify queries against the live API before committing, or reuse confirmed ones; prefer
REST when uncertain. See `docs/ARCHITECTURE.md` §Cloudflare API Integration and DECISIONS.md ADR-002.

### [2026-06-16] Cloudflare Status must use the Statuspage.io endpoint
**Context**: Fetching overall system status.
**Learning**: `www.cloudflarestatus.com` is behind CloudFront and returns 403 to programmatic
requests; the direct `yh6f0r4529hb.statuspage.io/api/v2` endpoint works (public, no auth).
**Impact**: Use the statuspage.io URL in `cloudflare-api-client.ts`. See DECISIONS.md ADR-001.

### [2026-06-16] Pin `vite` to ^7.3.2 for the @action decorator transform
**Context**: Test pipeline / dependency upgrades.
**Learning**: vitest 4.1.x resolves vite to v8, which breaks the `@action` TC39 decorator transform
("SyntaxError: Invalid or unexpected token" in action tests). Pinning `vite` to `^7.3.2` via
package.json `overrides` fixes it.
**Impact**: Don't remove the `vite` override when bumping test tooling. See DECISIONS.md ADR-003.

> Deeper SDK/device research lives in [`SKILLS.md`](./SKILLS.md); cross-plugin learnings are in the
> stream-deck-template `LEARNINGS.md` (see `docs/DEVELOPMENT-WORKFLOW.md` §Template Collaboration).
