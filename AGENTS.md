# Agent Instructions — Stream Deck Cloudflare Utilities

This document provides instructions for AI agents and automated contributors working on this project.

## Companion Guides

This file covers project rules, architecture, and workflow. Detailed guides live in dedicated files — **read them when working in those areas**:

| Document | When to Read |
|----------|-------------|
| **`.github/UI-DESIGN-GUIDE.md`** | Any work involving key display, SVG rendering, colors, layout, marquee, icons, Property Inspector, or visual changes. Contains all hardware-tested UX patterns, the color palette, font specs, and a log of failed design attempts. |
| **`.github/TESTING-PROTOCOL.md`** | Any work involving writing tests, mocking patterns, timer testing, coverage, or pre-release validation. Contains recipes, pitfalls, and the mandatory manual device testing protocol. |
| **`SKILLS.md`** | Deep reference: raw research data, SDK component catalog, device specs, and the complete design decisions log. Read before making novel UI changes. |
| **`content/CONTENT-GUIDE.md`** | Any work involving releases, version bumps, or Elgato Marketplace updates. Contains asset specs, release notes templates, description management, and the marketplace upload procedure. |

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
- **See `.github/TESTING-PROTOCOL.md`** for mocking patterns, timer testing recipes, and coverage details.

### 2. UI Changes Require Hardware Testing
- All visual changes must be tested on a **physical Stream Deck device**.
- Monitor screenshots are not sufficient — OLED displays have different gamma.
- **See `.github/UI-DESIGN-GUIDE.md`** for the accent bar pattern, color palette, font specs, and proven layouts.

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
npm run validate:consistency  # Check actions/manifest/PI/icons/tests/docs are in sync
npm run pack          # Full build + package (runs tests + lint + consistency first via prepack)

# Content (Elgato Marketplace)
npm run content:assets  # Regenerate PNG assets from SVG sources in content/assets/
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
3. `npm run validate:consistency` — all actions, manifest, PI, icons, tests, and docs are in sync.
4. `npm run build` — successful Rollup build.
5. `npm run validate` — Stream Deck CLI manifest/schema validation passes.
6. `streamdeck restart com.pedrofuentes.cloudflare-utilities` — plugin hot-reloads in Stream Deck without crash.

#### Manual device test (user performs this)
7. **ASK the user to test on their physical Stream Deck.** The agent must explicitly prompt:
   > "Before I tag and release, please test the plugin on your Stream Deck and confirm everything works. Specifically, please verify: [list what changed]."
8. **Provide a numbered, step-by-step manual test flow** covering every new feature or bug fix in the release. Each step must be concrete and actionable (e.g., "Add Worker Analytics action to a key → open PI → select a worker → verify the key shows request count"). Include:
   - **Setup steps** (add action to key, configure PI settings)
   - **Happy-path verification** (expected display, colors, values)
   - **Interaction tests** (key press behavior, metric cycling, dropdown changes)
   - **Edge-case checks** (long names for marquee, missing credentials, empty data)
   - **Regression checks** for existing actions that may be affected by the change
9. **Wait for explicit user confirmation** before proceeding to version bump / tag / push / release.

#### Why the CLI alone is NOT enough
- `streamdeck validate` only checks the manifest JSON schema — it does **not** test runtime behavior, UI rendering, API calls, or key display.
- `streamdeck restart` confirms the plugin loads without an immediate crash, but cannot verify functional correctness.
- `streamdeck dev` enables developer mode (debug logging) — useful for troubleshooting but not a substitute for manual testing.
- The Stream Deck CLI has **no automated functional testing** capability. All real verification must happen on the physical device.

#### What to verify on device
See **`.github/TESTING-PROTOCOL.md` → "Pre-Release Testing Protocol"** for the full device verification checklist.

#### Release flow (after user confirms)
```bash
# Version bump
# Edit package.json → new version
# Edit manifest.json → new Version (x.y.z.0 format)
# Update ROADMAP.md (current version header + rollout table)

git add -A && git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin main --tags
npm run pack  # Produces dist/*.streamDeckPlugin
```

#### Create GitHub Release (MANDATORY)
**Every release MUST have a GitHub Release with the `.streamDeckPlugin` package attached.** This is the primary distribution method for end users.

1. Run `npm run pack` — this produces `dist/com.pedrofuentes.cloudflare-utilities.streamDeckPlugin`.
2. Create a GitHub Release for tag `vx.y.z` via the GitHub CLI or web UI:
   ```bash
   gh release create vx.y.z dist/com.pedrofuentes.cloudflare-utilities.streamDeckPlugin \
     --title "vx.y.z" \
     --notes "Release notes here" \
     --repo pedrofuentes/stream-deck-cloudflare-utilities
   ```
3. The release notes should summarize what changed (features, fixes, refactors).
4. The `.streamDeckPlugin` file must be attached as a release asset so users can download and double-click to install.

**Never skip the GitHub Release.** A git tag without a GitHub Release and attached package is an incomplete release.

#### Post-release — Update Roadmap (MANDATORY)
After every release, update `ROADMAP.md`:
1. Update the `Current version` in the header.
2. Strike-through the shipped version row in the **Recommended Rollout Order** table.
3. If new items were shipped that aren't in the table, add them as a new row.
4. These changes should be included in the version bump commit (before tagging), not as a separate commit.

#### Post-release — Update Elgato Marketplace Content (MANDATORY)
After every release, update the marketplace content. **See `content/CONTENT-GUIDE.md`** for full details.
1. Write release notes in `content/release-notes.md`.
2. Review `content/description.md` — update if features changed.
3. Update gallery SVGs in `content/assets/` if key display changed.
4. Run `npm run content:assets` to regenerate PNGs from SVGs.
5. Commit content changes with the version bump.
6. After GitHub Release: copy release notes and upload new assets to the Elgato Marketplace developer portal.

---

## Architecture

### Directory Structure
```
src/
├── actions/          # One file per Stream Deck action
├── services/         # API clients, business logic (no SD dependency)
├── types/            # TypeScript interfaces and type definitions
└── plugin.ts         # Entry point - registers actions, connects to SD

scripts/              # Build & validation scripts
└── validate-consistency.ts  # Plugin consistency validator

content/              # Elgato Marketplace content (see content/CONTENT-GUIDE.md)
├── CONTENT-GUIDE.md  # Agent instructions for marketplace content
├── description.md    # Plugin description (4000 char limit)
├── release-notes.md  # Release notes per version (1500 char limit each)
└── assets/           # SVG sources + generated PNGs for marketplace

tests/                # Mirrors src/ structure
├── actions/
├── scripts/
├── services/
└── types/

plugin/               # Plugin source assets (tracked in git)
├── imgs/             # Icons (SVG & PNG)
├── ui/               # Property inspector HTML
├── manifest.json     # Plugin manifest
└── .sdignore         # Packaging exclusions

release/              # Build output (gitignored)
└── com.pedrofuentes.cloudflare-utilities.sdPlugin/
    ├── bin/          # Compiled JS (Rollup output)
    ├── imgs/         # Copied from plugin/
    ├── ui/           # Copied from plugin/
    └── manifest.json # Copied from plugin/
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
3. **Add** the action to `plugin/manifest.json`.
4. **Create** `plugin/ui/<action-name>.html` if the action needs settings.
5. **Add** icon SVGs in `plugin/imgs/actions/`.
6. **Write tests** in `tests/actions/<action-name>.test.ts` — see `.github/TESTING-PROTOCOL.md` for patterns.
7. **Follow UI rules** in `.github/UI-DESIGN-GUIDE.md` — use the shared renderer, accent bar pattern, etc.
8. **Update** `README.md` to document the new action.

## How to Add a New Service

1. **Create** `src/services/<service-name>.ts`.
2. **Define types** in `src/types/` if introducing new data shapes.
3. **Write tests** in `tests/services/<service-name>.test.ts`.
4. **Mock external calls** using `vi.fn()` / `vi.stubGlobal()` — never make real HTTP calls in tests.

---

## Testing Guidelines

**Full details in `.github/TESTING-PROTOCOL.md`.** Key points:

- Mock `fetch` with `vi.stubGlobal("fetch", mockFetch)`.
- Mock the Stream Deck SDK module in every action test.
- Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` for timer tests.
- Always restore real timers in `afterEach`.
- Test all HTTP error codes (400, 401, 403, 404, 429, 500, 502, 503).
- Test network failures, JSON parse errors, empty inputs, boundary values.
- See `.github/TESTING-PROTOCOL.md` for recipes: marquee testing, backoff testing, polling testing.

---

## UI / Key Display Rules

**Full details in `.github/UI-DESIGN-GUIDE.md`.** Non-negotiable summary:

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
- Update `.github/UI-DESIGN-GUIDE.md` if visual patterns or discoveries change.
- Update `.github/TESTING-PROTOCOL.md` if testing patterns or pitfalls change.
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
3. **`plugin/ui/setup.html`** — Shared setup window opened from any action's PI. Reads/writes global settings via `$SD.getGlobalSettings()` / `$SD.setGlobalSettings()`.
4. **Each action** subscribes via `onGlobalSettingsChanged()` and re-initializes when credentials change.

### Adding global settings fields

1. Update the `GlobalSettings` type in `global-settings-store.ts`.
2. Update `setup.html` with new input fields.
3. Actions automatically pick up changes via the pub/sub system.

---

## Template Collaboration Protocol

This plugin is part of the **stream-deck-template** knowledge-sharing ecosystem.
All Stream Deck plugins share the same SDK, hardware constraints, and pitfalls.
Learnings discovered here benefit every other plugin.

- **Template repo**: https://github.com/pedrofuentes/stream-deck-template
- **This plugin's contributions**: `contributions/cloudflare-utilities.md` in the template repo
- **Consolidated knowledge**: `LEARNINGS.md` in the template repo

### Reading Knowledge From the Template

Before starting major work on a new feature, refactor, or release, fetch and read
the latest `LEARNINGS.md` from the template:

```
https://raw.githubusercontent.com/pedrofuentes/stream-deck-template/main/LEARNINGS.md
```

This contains detailed, code-level patterns for:
- SVG rendering compatibility and OLED-tested color palettes
- Property Inspector patterns (popup windows, dropdown hydration, FilterableSelect, settings race conditions)
- Architecture patterns (global settings pub/sub, service layer isolation, PollingCoordinator, resource managers)
- Adaptive polling, rate limit handling, key-press cycling, short/long press detection
- Marquee animations, compact number formatting, accent bar layout, viewport-aware dropdowns
- Testing patterns (singleton store resets, fixture organization, SVG assertion helpers)
- Build pipeline, validate:consistency script, release checklist, PI verification gate
- Common mistakes table with 23+ entries

### Contributing Knowledge Back

After completing significant work, **proactively offer** to contribute new learnings
to the template. This is expected — not optional.

**How:**
1. Fetch the template's contribution file for this plugin:
   `https://raw.githubusercontent.com/pedrofuentes/stream-deck-template/main/contributions/cloudflare-utilities.md`
2. Read it to understand what has already been contributed
3. Write new findings using the format below
4. Push to the template repo (clone it, or ask the user to switch workspaces)
5. Commit with: `docs(cloudflare-utilities): add learnings about <topic>`

**Contribution format:**
```markdown
## [Category] — [Short Title]

**Discovered in**: cloudflare-utilities
**Date**: <date>
**Severity**: critical | important | nice-to-know

**Problem**: What went wrong or what was unclear
**Solution**: What fixed it
**Code example** (if applicable)
**Prevention**: How to avoid this in the future
```

**When to offer a contribution:**
- After solving a non-obvious bug or hardware quirk
- After implementing a reusable pattern (polling, caching, UI component)
- After discovering a manifest or SDK constraint
- After a release (summarize what was learned)
- After refactoring something that other plugins also have
- When the session is wrapping up and the user asks "anything else?"

**When NOT to contribute:**
- Plugin-specific business logic (API response parsing unique to this plugin)
- Trivial fixes that don't generalize
- Things already covered in `LEARNINGS.md`

### Checking for Updates From Other Plugins

Other plugins may have discovered patterns that help this one. Before a release
or when troubleshooting, check if `LEARNINGS.md` has new entries by fetching and
scanning the sections relevant to the current task.

### Template Companion Guides

The template also maintains merged guides that this plugin may benefit from:

| Guide | URL |
|-------|-----|
| Testing Protocol | `https://raw.githubusercontent.com/pedrofuentes/stream-deck-template/main/scaffold/.github/TESTING-PROTOCOL.md` |
| UI/UX Design Guide | `https://raw.githubusercontent.com/pedrofuentes/stream-deck-template/main/scaffold/.github/UI-DESIGN-GUIDE.md` |

Read these before writing tests or making UI changes — they contain hardware-tested
patterns and failure logs from multiple plugins.
