# Per-Key Cloudflare Account Selection Implementation Plan

> **Historical implementation note:** This plan was carried out as test-first RED/GREEN
> increments, with each behavior change preceded by its failing test commit.

**Goal:** Allow authenticated Stream Deck keys sharing one global Cloudflare token to select
and operate against different Cloudflare accounts.

**Architecture:** Add account ID/name to each authenticated action's settings, retain a narrow
legacy fallback for configured upgraded keys, isolate `SingletonAction` runtime state by action
ID, and use one shared Property Inspector account selector.

**Tech Stack:** TypeScript 5.9 strict, `@elgato/streamdeck` 2.1, browser JavaScript, Vitest 4,
Node 20+, npm.

## Constraints

- Work only on `fix/per-key-account-selection` in its isolated worktree.
- API token and refresh interval remain global; account ID/name are per key.
- Cloudflare Status is excluded.
- Keep deprecated global `accountId` only for configured-key migration.
- Add no dependencies, endpoints, datasets, manifest changes, version bump, package, tag, or
  release.
- Commit failing tests before each behavior implementation.
- Never edit `AGENTS.md` or `docs/SENTINEL.md`.

## Task 1: Account resolution

1. Add failing service tests for local precedence, configured-key fallback, blank-key
   rejection, and optional account name.
2. Commit tests as `test(accounts): add failing per-key account resolution tests` and verify
   the scoped suite fails for the missing contract.
3. Add `AccountSelectionSettings`, `ResolvedAccountSelection`, and
   `resolveAccountSelection(settings, legacyAccountId, hasConfiguredResource)`.
4. Intersect the shared settings into all nine authenticated setting types and mark global
   `accountId` deprecated.
5. Commit as `fix(accounts): resolve account selection per key` and verify scoped/full tests.

## Task 2: Per-key authenticated runtime

1. Add failing action tests with two action IDs using distinct accounts, independent API calls,
   caches/timers/polling cleanup, configured legacy fallback, blank-key behavior, and stale
   response rejection.
2. Commit as `test(actions): add failing per-key account behavior tests`.
3. Replace shared mutable action fields with per-action-ID state maps. Resolve account from
   each event's settings, construct account-scoped clients from it, include account in request
   identity, and clean up only the disappearing key.
4. Commit as `fix(actions): isolate Cloudflare account state per key` and run all action/full
   tests.

## Task 3: Shared Property Inspector selector

1. Add dependency-free failing Vitest coverage for account pagination, sorting, ID/name
   persistence, sole-account selection, unavailable accounts, failures, and dependent-field
   clearing. Add PI integration checks.
2. Commit as `test(pi): add failing per-key account selector tests`.
3. Implement `plugin/ui/account-selector.js`; integrate it into all nine authenticated PIs,
   remove Account from setup, and use local account settings in resource requests.
4. Filter Zone Analytics and DNS zone lists by selected account.
5. Commit as `fix(pi): select Cloudflare account per key`; run PI/full/consistency tests.

## Task 4: Documentation and gates

1. Update README, CHANGELOG, architecture, ADRs, and LEARNINGS with the split settings model,
   migration, and per-key singleton-state rule.
2. Commit as `docs(accounts): document per-key account selection`.
3. Verify commit choreography, full tests, 80% coverage gates, lint, consistency, build, and
   Stream Deck validation.
4. Push one PR, invoke an independent full Sentinel review, persist the full report, and merge
   only after an APPROVED/CONDITIONAL verdict and completed pre-merge checklist.
