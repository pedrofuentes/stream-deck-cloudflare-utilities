# Agent Instructions — Stream Deck Cloudflare Utilities

This document provides instructions for AI agents and automated contributors working on this project.

## Companion Guides

This file covers project rules, architecture, and workflow. Detailed guides live in dedicated files — **read them when working in those areas**:

| Document | When to Read |
|----------|-------------|
| **`UI-DESIGN-GUIDE.md`** | Any work involving key display, SVG rendering, colors, layout, marquee, icons, Property Inspector, or visual changes. Contains all hardware-tested UX patterns, the color palette, font specs, and a log of failed design attempts. |
| **`TESTING-PROTOCOL.md`** | Any work involving writing tests, mocking patterns, timer testing, coverage, or pre-release validation. Contains recipes, pitfalls, and the mandatory manual device testing protocol. |
| **`SKILLS.md`** | Deep reference: raw research data, SDK component catalog, device specs, and the complete design decisions log. Read before making novel UI changes. |

---

## Project Overview

This is a **Stream Deck plugin** built with:
- **Language**: TypeScript (strict mode)
- **SDK**: `@elgato/streamdeck` v2 (Stream Deck SDK)
- **Bundler**: Rollup
- **Testing**: Vitest
- **CLI**: `@elgato/cli` (Stream Deck CLI)
- **Plugin UUID**: `com.pedrofuentes.cloudflare-utilities`
- **Repository**: https://github.com/pedrofuentes/stream-deck-cloudflare-utilities

---

## Critical Rules

### 1. Tests Are Mandatory
- **Every change MUST include tests.** No exceptions.
- **All tests MUST pass before any commit, merge, or deploy.**
- Edge cases must always be covered: empty inputs, error states, network failures, unexpected data shapes, boundary values.
- Ensure no regression — run `npm test` and verify 100% pass rate.
- Coverage thresholds: 80% branches, functions, lines, statements.
- **See `TESTING-PROTOCOL.md`** for mocking patterns, timer testing recipes, and coverage details.

### 2. UI Changes Require Hardware Testing
- All visual changes must be tested on a **physical Stream Deck device**.
- Monitor screenshots are not sufficient — OLED displays have different gamma.
- **See `UI-DESIGN-GUIDE.md`** for the accent bar pattern, color palette, font specs, and proven layouts.

### 3. Commands
```bash
# Testing
npm test              # Run all tests (must pass before every commit)
npm run test:watch    # Watch mode during development
npm run test:coverage # Generate coverage report

# Building
npm run build         # Build with Rollup
npm run lint          # TypeScript type-check (no emit)
npm run validate      # Validate plugin with Stream Deck CLI
npm run pack          # Full build + package (runs tests first via prepack)
```

### 4. Release Packaging
```bash
npm run pack
```
This runs `prepack` (test + lint), then `build`, then `streamdeck pack` to produce a `.streamDeckPlugin` file in `dist/`.

**Never skip tests before packaging.** The `prepack` script enforces this.

### 5. Pre-Release Checklist — MANDATORY

**Agents MUST NOT tag, push, or create a release without completing every step below.** This is a blocking gate — no exceptions.

#### Automated checks (agent runs these)
1. `npm test` — all tests pass.
2. `npm run lint` — no TypeScript errors.
3. `npm run build` — successful Rollup build.
4. `npm run validate` — Stream Deck CLI manifest/schema validation passes.
5. `streamdeck restart com.pedrofuentes.cloudflare-utilities` — plugin hot-reloads in Stream Deck without crash.

#### Manual device test (user performs this)
6. **ASK the user to test on their physical Stream Deck.** The agent must explicitly prompt:
   > "Before I tag and release, please test the plugin on your Stream Deck and confirm everything works. Specifically, please verify: [list what changed]."
7. **Provide a numbered, step-by-step manual test flow** covering every new feature or bug fix in the release. Each step must be concrete and actionable (e.g., "Add Worker Analytics action to a key → open PI → select a worker → verify the key shows request count"). Include:
   - **Setup steps** (add action to key, configure PI settings)
   - **Happy-path verification** (expected display, colors, values)
   - **Interaction tests** (key press behavior, metric cycling, dropdown changes)
   - **Edge-case checks** (long names for marquee, missing credentials, empty data)
   - **Regression checks** for existing actions that may be affected by the change
8. **Wait for explicit user confirmation** before proceeding to version bump / tag / push / release.

#### Why the CLI alone is NOT enough
- `streamdeck validate` only checks the manifest JSON schema — it does **not** test runtime behavior, UI rendering, API calls, or key display.
- `streamdeck restart` confirms the plugin loads without an immediate crash, but cannot verify functional correctness.
- `streamdeck dev` enables developer mode (debug logging) — useful for troubleshooting but not a substitute for manual testing.
- The Stream Deck CLI has **no automated functional testing** capability. All real verification must happen on the physical device.

#### What to verify on device
See **`TESTING-PROTOCOL.md` → "Pre-Release Testing Protocol"** for the full device verification checklist.

#### Release flow (after user confirms)
```bash
# Version bump
# Edit package.json → new version
# Edit manifest.json → new Version (x.y.z.0 format)

git add -A && git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin main --tags
npm run pack  # Produces dist/*.streamDeckPlugin
```

---

## Architecture

### Directory Structure
```
src/
├── actions/          # One file per Stream Deck action
├── services/         # API clients, business logic (no SD dependency)
├── types/            # TypeScript interfaces and type definitions
└── plugin.ts         # Entry point - registers actions, connects to SD

tests/                # Mirrors src/ structure
├── actions/
├── services/
└── types/

com.pedrofuentes.cloudflare-utilities.sdPlugin/  # Compiled plugin
├── bin/              # Build output (JS)
├── imgs/             # Icons (SVG)
├── ui/               # Property inspector HTML
├── manifest.json     # Plugin manifest
└── .sdignore         # Packaging exclusions
```

### Key Patterns

- **Actions** extend `SingletonAction<TSettings>` from `@elgato/streamdeck`.
- **Services** are plain TypeScript classes with no Stream Deck dependency — easily testable.
- **Types** are shared interfaces in `src/types/`.
- **Plugin entry** (`src/plugin.ts`) only registers actions and connects. Keep it minimal.

### UUID Convention
- Plugin: `com.pedrofuentes.cloudflare-utilities`
- Actions: `com.pedrofuentes.cloudflare-utilities.<action-name>`

---

## How to Add a New Action

1. **Create** `src/actions/<action-name>.ts` with a class extending `SingletonAction`.
2. **Register** the action in `src/plugin.ts`.
3. **Add** the action to `com.pedrofuentes.cloudflare-utilities.sdPlugin/manifest.json`.
4. **Create** `com.pedrofuentes.cloudflare-utilities.sdPlugin/ui/<action-name>.html` if the action needs settings.
5. **Add** icon SVGs in `com.pedrofuentes.cloudflare-utilities.sdPlugin/imgs/actions/`.
6. **Write tests** in `tests/actions/<action-name>.test.ts` — see `TESTING-PROTOCOL.md` for patterns.
7. **Follow UI rules** in `UI-DESIGN-GUIDE.md` — use the shared renderer, accent bar pattern, etc.
8. **Update** `README.md` to document the new action.

## How to Add a New Service

1. **Create** `src/services/<service-name>.ts`.
2. **Define types** in `src/types/` if introducing new data shapes.
3. **Write tests** in `tests/services/<service-name>.test.ts`.
4. **Mock external calls** using `vi.fn()` / `vi.stubGlobal()` — never make real HTTP calls in tests.

---

## Testing Guidelines

**Full details in `TESTING-PROTOCOL.md`.** Key points:

- Mock `fetch` with `vi.stubGlobal("fetch", mockFetch)`.
- Mock the Stream Deck SDK module in every action test.
- Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` for timer tests.
- Always restore real timers in `afterEach`.
- Test all HTTP error codes (400, 401, 403, 404, 429, 500, 502, 503).
- Test network failures, JSON parse errors, empty inputs, boundary values.
- See `TESTING-PROTOCOL.md` for recipes: marquee testing, backoff testing, polling testing.

---

## UI / Key Display Rules

**Full details in `UI-DESIGN-GUIDE.md`.** Non-negotiable summary:

1. **Always use `setImage`**, never `setTitle` alone.
2. **Use the accent bar pattern** — 6px colored bar at top.
3. **Center all text** — `text-anchor="middle"` at `x="72"`.
4. **Use the shared renderer** — `src/services/key-image-renderer.ts`.
5. **Manifest**: `"ShowTitle": false` in `States`, `"UserTitleEnabled": false` at Action level.
6. **Marquee** for names > 10 characters — use `MarqueeController`.
7. **Action list icons**: monochromatic white on transparent, 20×20 SVG.

---

## Documentation Updates

Whenever you make changes that affect the project:
- Update `README.md` (features, scripts, structure, etc.)
- Update `CONTRIBUTING.md` if development workflow changes.
- Update this file (`AGENTS.md`) if architecture or conventions change.
- Update `UI-DESIGN-GUIDE.md` if visual patterns or discoveries change.
- Update `TESTING-PROTOCOL.md` if testing patterns or pitfalls change.
- Update `SKILLS.md` if new raw research or SDK findings are discovered.

---

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(actions): add zone analytics action
fix(services): handle API rate limiting
test(services): add timeout edge case tests
docs(readme): add zone analytics documentation
```

---

## Branching Model

This project uses a **GitHub Flow** branching model. All work happens on feature branches; `main` is always deployable.

### Rules

1. **`main` is protected.** Never commit directly to `main`. All changes go through feature branches.
2. **One branch per feature or fix.** Create a branch, do the work, merge back to `main`.
3. **Tests must pass** on the branch before merging.
4. **Delete the branch** after merging.

### Branch Naming

Use the conventional commit type as prefix, followed by a short kebab-case description:

```
feat/<short-description>     # New features or actions
fix/<short-description>      # Bug fixes
refactor/<short-description> # Code restructuring
docs/<short-description>     # Documentation changes
chore/<short-description>    # Build, config, dependency updates
test/<short-description>     # Test-only changes
```

**Examples:**
```
feat/worker-analytics-action
feat/component-drilldown
fix/rate-limit-backoff
refactor/extract-polling-mixin
docs/update-roadmap
chore/upgrade-sdk-v2.1
```

### Workflow

```
main ─────────────────────────────────────────── main
       \                                      /
        feat/worker-analytics ───────────────
```

1. **Create branch**: `git checkout -b feat/worker-analytics`
2. **Develop**: Make commits on the branch (conventional commits).
3. **Test**: `npm test` — all tests must pass.
4. **Merge**: `git checkout main && git merge feat/worker-analytics`
5. **Tag release** (if applicable): `git tag v1.1.0 && git push --tags`
6. **Delete branch**: `git branch -d feat/worker-analytics`
7. **Push**: `git push origin main`

### Release Versions

- Each planned version in `ROADMAP.md` gets its features built on separate branches.
- After all branches for a version are merged, bump the version, run `npm run pack`, and create a GitHub release.
- Version tags (`v1.1.0`, `v1.2.0`) are created on `main` after merging.

---

## Environment

- No `.env` files are committed. API keys are stored in **Stream Deck global settings** (shared across all actions) via the setup window.
- The Cloudflare Status API uses the Statuspage.io endpoint (`yh6f0r4529hb.statuspage.io/api/v2`) — public, no auth required. The `www.cloudflarestatus.com` domain is behind CloudFront WAF and blocks programmatic requests with 403.
- The Cloudflare Workers API and AI Gateway GraphQL API require user-provided API tokens stored in global settings.
- Rate limiting (HTTP 429) is handled with graceful backoff — see `RateLimitError` in `cloudflare-ai-gateway-api.ts`.

---

## Global Settings Architecture

API credentials (API Token, Account ID) are shared across all actions via Stream Deck's global settings system.

### How it works

1. **`src/services/global-settings-store.ts`** — In-memory store with pub/sub. Actions subscribe to changes.
2. **`src/plugin.ts`** — Loads global settings on startup and listens for updates via `onDidReceiveGlobalSettings`.
3. **`com.pedrofuentes.cloudflare-utilities.sdPlugin/ui/setup.html`** — Shared setup window opened from any action's PI. Reads/writes global settings via `$SD.getGlobalSettings()` / `$SD.setGlobalSettings()`.
4. **Each action** subscribes via `onGlobalSettingsChanged()` and re-initializes when credentials change.

### Adding global settings fields

1. Update the `GlobalSettings` type in `global-settings-store.ts`.
2. Update `setup.html` with new input fields.
3. Actions automatically pick up changes via the pub/sub system.

---

## Contributing Learnings Back to the Template

This plugin was created from the **stream-deck-template**: https://github.com/pedrofuentes/stream-deck-template

The template is a shared knowledge hub for all Stream Deck plugins. As an agent, you should **proactively contribute new learnings** back to it after completing significant work.

### Before Starting Major Work

Read `S:\Pedro\Projects\stream-deck-template\LEARNINGS.md` for the latest consolidated knowledge from all plugins (iCal, GitHub Utilities, Cloudflare Utilities, and any future plugins). This avoids re-discovering known pitfalls and ensures you benefit from solutions found in other projects.

### When to Offer a Contribution

- After solving a **non-obvious bug** or hardware quirk
- After implementing a **reusable pattern** (polling, caching, UI, testing)
- After discovering a **manifest or SDK constraint**
- After a **release** (summarize what was learned)
- When the session is **wrapping up** or the user asks "anything else?"

### How to Contribute

1. **Write** findings to `S:\Pedro\Projects\stream-deck-template\contributions\cloudflare-utilities.md` using the format defined in `COLLABORATION.md`.
2. **Commit and push** (or open a PR) to https://github.com/pedrofuentes/stream-deck-template with a conventional commit:
   ```
   docs(cloudflare-utilities): add learnings about <topic>
   ```
3. Only add **NEW** learnings — read `LEARNINGS.md` first to avoid duplicating existing knowledge.

### Contribution Format

```markdown
## [Category] — Short Title

**Discovered in**: cloudflare-utilities
**Date**: <date>
**Severity**: critical | important | nice-to-know

**Problem**: What went wrong or what was unclear
**Solution**: What fixed it
**Code example** (if applicable)
**Prevention**: How to avoid this in the future
```
