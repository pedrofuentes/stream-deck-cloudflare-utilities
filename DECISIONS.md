# Architecture Decision Records — Stream Deck Cloudflare Utilities

> **Record every significant technical decision here.** When choosing between approaches,
> document what was chosen and why. This prevents future agents and developers from
> re-debating settled decisions or accidentally reversing them.
>
> Do NOT write decisions to AGENTS.md — they belong here.

## Format

```markdown
### ADR-NNN: Decision Title
**Date**: YYYY-MM-DD
**Status**: Proposed / Accepted / Superseded by ADR-NNN
**Context**: What problem or question prompted this decision?
**Decision**: What was decided?
**Alternatives considered**: What other options were evaluated?
**Consequences**: What are the trade-offs? What does this enable or prevent?
```

## Decisions

<!-- Add new decisions below this line, most recent first -->

### ADR-005: Adopt agents-template (v0.16.0) for the agent workflow
**Date**: 2026-06-16
**Status**: Accepted
**Context**: The project had a single large `AGENTS.md` plus specialized guides, but no
enforced review gate or standardized TDD/branching protocol for AI agents.
**Decision**: Migrate to the agents-template — `AGENTS.md` as the operating system (TDD commit
choreography, git worktrees, ASK FIRST / NEVER boundaries) plus `docs/SENTINEL.md` as a
sub-agent pre-merge quality gate. Sentinel invocation method = **A (sub-agent)**.
**Alternatives considered**: Keep the bespoke `AGENTS.md`; adopt only Sentinel; use a CI status
check (Method B) — rejected because there is no CI pipeline yet.
**Consequences**: Stricter, auditable workflow. Existing hardware-tested guides
(`.github/UI-DESIGN-GUIDE.md`, `.github/TESTING-PROTOCOL.md`, `SKILLS.md`,
`content/CONTENT-GUIDE.md`) are retained and cross-linked, not replaced.

### ADR-004: Share credentials via Stream Deck global settings (pub/sub)
**Date**: 2026-01
**Status**: Accepted
**Context**: Multiple actions need the same Cloudflare API Token + Account ID; committing
secrets or duplicating per-action settings is unsafe and error-prone.
**Decision**: Store credentials in Stream Deck **global settings**, exposed through an in-memory
pub/sub store (`global-settings-store.ts`); actions subscribe and re-initialize on change. A
shared `setup.html` window reads/writes them.
**Alternatives considered**: `.env` files (not available at runtime on a user's machine;
secret-leak risk); per-action settings (duplicated, easy to desync).
**Consequences**: One setup window configures every action; no secrets in the repo. Adding a
field means updating the `GlobalSettings` type and `setup.html` only.

### ADR-003: Pin `vite` to ^7.3.2 via package overrides
**Date**: 2026-02
**Status**: Accepted
**Context**: `vitest` 4.1.x resolves `vite` to v8, which breaks the `@action` TC39 decorator
transform in the test pipeline ("SyntaxError: Invalid or unexpected token" in action tests).
**Decision**: Pin `vite` to `^7.3.2` (and `esbuild` to `^0.28.1`) in package.json `overrides`.
**Alternatives considered**: Enable `experimentalDecorators` / change tsconfig target; drop
decorator usage — both more invasive than a dependency pin.
**Consequences**: Tests pass on the `@action` decorator. Do NOT remove the `vite` override when
bumping vitest; re-validate decorator tests on any test-tooling upgrade.

### ADR-002: Prefer REST over GraphQL when a dataset/field is uncertain
**Date**: 2026-02
**Status**: Accepted
**Context**: Cloudflare's GraphQL Analytics dataset and field names are inconsistently
documented, not guessable, and vary in available aggregations (`sum` vs `max`). Some assumed
endpoints don't exist (`workersKvStorageAdaptiveGroups`, `/storage/analytics`).
**Decision**: Verify every GraphQL query against the live API before committing; otherwise reuse
only confirmed queries, and prefer REST endpoints for metadata (e.g., D1 size via
`/d1/database/{id}` → `file_size`).
**Alternatives considered**: Guess dataset/field names from product names — caused production
failures.
**Consequences**: Reliable analytics actions. New integrations require live verification; the
validated dataset list lives in `docs/ARCHITECTURE.md` §Cloudflare API Integration.

### ADR-001: Use the Statuspage.io endpoint for Cloudflare Status
**Date**: 2026-02
**Status**: Accepted
**Context**: The Cloudflare Status action needs a public status feed.
**Decision**: Call the Atlassian Statuspage endpoint
`https://yh6f0r4529hb.statuspage.io/api/v2` directly (public, no auth).
**Alternatives considered**: The branded `www.cloudflarestatus.com` domain — it sits behind
CloudFront and returns 403 to programmatic requests.
**Consequences**: Status fetching works without auth. The endpoint URL is hard-coded in
`cloudflare-api-client.ts`; if it ever changes, update that constant.
