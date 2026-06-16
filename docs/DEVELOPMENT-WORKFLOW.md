# Development Workflow

> Extended workflow context for AI agents. Referenced from AGENTS.md.
> **The MUST rules (TDD, branching, worktrees, incremental development, Sentinel) are enforced in AGENTS.md.**
> This document covers the detailed HOW.

---

## Git Worktrees for Isolation

Every increment MUST use a git worktree for isolation:

```bash
# Fetch latest main, create worktree with new branch
git fetch origin main
git worktree add .worktrees/feature-name -b feature/feature-name main

# Change into the worktree
cd .worktrees/feature-name

# If worktree already exists (retry/recovery), just cd into it
# git worktree list  # check existing worktrees

# List active worktrees
git worktree list

# Remove a worktree when done (after merge — cd back to main worktree first)
cd <main-worktree-root>
git worktree remove .worktrees/feature-name
git branch -D feature/feature-name
```

### Why Worktrees Are Required
- Prevents interference between parallel work
- Each agent/increment has a clean working directory
- No risk of uncommitted changes from one task affecting another
- Easy cleanup after merge

## Branching Details

### Branch Lifecycle
1. Fetch latest: `git fetch origin main`
2. Create worktree + branch from `main`: `git worktree add .worktrees/name -b feature/name main && cd .worktrees/name`
3. TDD: write failing tests, implement, refactor
4. Commit following the format in AGENTS.md
5. Push branch: `git push -u origin feature/name`
6. Open PR: `gh pr create` or via GitHub UI
7. Invoke Sentinel for review
8. Address any Sentinel feedback, re-submit
9. On Sentinel approval, merge to `main`
10. Cleanup: `cd <main-root> && git worktree remove .worktrees/name && git branch -D feature/name`

### Branch Naming Convention
| Prefix | Use For |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `refactor/` | Code refactoring |
| `docs/` | Documentation changes |
| `test/` | Test additions or fixes |
| `chore/` | Build, CI, dependency updates |

## Pull Request Process

### Before Opening a PR
1. All tests pass in the worktree
2. Linting passes
3. Commit messages follow the format
4. PR represents a single logical unit

### PR Title Format
`type(scope): Short description`

### Sentinel Review
→ See [`docs/SENTINEL.md`](./SENTINEL.md) for the full process and invocation methods.

### After Merge
```bash
cd <main-worktree-root>
git worktree remove .worktrees/feature-name
git branch -D feature/name
git pull origin main
```
- Start next increment from the plan
- If other worktrees are in progress, rebase them: `cd .worktrees/other && git fetch origin main && git rebase origin/main`

## Sub-Agent Delegation

### When to Delegate
- Complex research that requires deep analysis
- Documentation generation
- Test data creation or fixture generation
- Performance profiling and optimization analysis
- Security vulnerability assessment

### How to Delegate
- Provide the sub-agent with full context (requirements, constraints, relevant code)
- Each sub-agent works in its own context
- Integrate sub-agent output back into the main work
- All sub-agent output must follow AGENTS.md rules

## Environment Setup

**Prerequisites**: Node.js 20+, npm, the Stream Deck desktop app, and the Elgato CLI
(`npm i -g @elgato/cli`, or use `npx streamdeck`).

```bash
git clone https://github.com/pedrofuentes/stream-deck-cloudflare-utilities.git
cd stream-deck-cloudflare-utilities
npm install
npm run build                 # Rollup → release/
npm run streamdeck:link       # link release/…sdPlugin into Stream Deck
npm run watch                 # rebuild + auto-restart the plugin on change
```

- **No `.env` / secrets in the repo.** Cloudflare credentials (API Token, Account ID) are
  entered at runtime in the plugin's shared setup window and stored in Stream Deck global
  settings. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §Global Settings Architecture.
- Useful scripts: `npm run streamdeck:restart`, `npm run streamdeck:dev` (debug logging),
  `npm run validate`, `npm run validate:consistency`.

## Adding an Action or Service

**New action**: create `src/actions/<name>.ts` (extends `SingletonAction`) → register in
`src/plugin.ts` → add to `plugin/manifest.json` → add `plugin/ui/<name>.html` (if it has
settings) → add icons in `plugin/imgs/actions/` → write `tests/actions/<name>.test.ts` →
follow the UI rules in [`../.github/UI-DESIGN-GUIDE.md`](../.github/UI-DESIGN-GUIDE.md) →
document it in `README.md`. Run `npm run validate:consistency` to confirm everything is in sync.

**New service**: create `src/services/<name>.ts` (no `@elgato/streamdeck` import) → add types in
`src/types/` → write `tests/services/<name>.test.ts` mocking `fetch`.

## Pre-Release Gate

Releasing is a **HUMAN REQUIRED** step — never tag, `npm run pack`, or publish without the
user's physical-device test. The full automated + manual checklist is in AGENTS.md
§Stream Deck Project Rules and
[`../.github/TESTING-PROTOCOL.md`](../.github/TESTING-PROTOCOL.md).

## Template Collaboration

This plugin participates in the **stream-deck-template** knowledge-sharing ecosystem (separate
from agents-template). All Stream Deck plugins share the same SDK, hardware constraints, and
pitfalls, so learnings are pooled.

- Template repo: https://github.com/pedrofuentes/stream-deck-template
- This plugin's contribution file: `contributions/cloudflare-utilities.md` in that repo
- Consolidated knowledge: `LEARNINGS.md` in that repo

**Before major work**, read the latest consolidated learnings:
```
https://raw.githubusercontent.com/pedrofuentes/stream-deck-template/main/LEARNINGS.md
```
It covers SVG rendering, Property Inspector patterns, polling, rate limiting, marquee, compact
number formatting, testing patterns, and a common-mistakes table.

**After significant work**, proactively offer to contribute new findings back using this format:
```markdown
## [Category] — [Short Title]
**Discovered in**: cloudflare-utilities
**Date**: <date>
**Severity**: critical | important | nice-to-know
**Problem**: …
**Solution**: …
**Prevention**: …
```
Commit to the template repo as `docs(cloudflare-utilities): add learnings about <topic>`.
Contribute generalizable SDK / hardware / testing learnings — not plugin-specific business
logic or anything already in `LEARNINGS.md`.
