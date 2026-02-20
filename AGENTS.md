# Agent Instructions — Stream Deck Cloudflare Utilities

This document provides instructions for AI agents and automated contributors working on this project.

## Project Overview

This is a **Stream Deck plugin** built with:
- **Language**: TypeScript (strict mode)
- **SDK**: `@elgato/streamdeck` v2 (Stream Deck SDK)
- **Bundler**: Rollup
- **Testing**: Vitest
- **CLI**: `@elgato/cli` (Stream Deck CLI)
- **Plugin UUID**: `com.pedrofuentes.cloudflare-utilities`
- **Repository**: https://github.com/pedrofuentes/stream-deck-cloudflare-utilities

## Critical Rules

### 1. Tests Are Mandatory
- **Every change MUST include tests.** No exceptions.
- **All tests MUST pass before any commit, merge, or deploy.**
- Edge cases must always be covered: empty inputs, error states, network failures, unexpected data shapes, boundary values.
- Ensure no regression — run `npm test` and verify 100% pass rate.
- Coverage thresholds: 80% branches, functions, lines, statements.

### 2. Testing Commands
```bash
npm test              # Run all tests (must pass before deploy)
npm run test:watch    # Watch mode during development
npm run test:coverage # Generate coverage report
```

### 3. Build & Validation
```bash
npm run build         # Build with Rollup
npm run lint          # TypeScript type-check (no emit)
npm run validate      # Validate plugin with Stream Deck CLI
npm run pack          # Full build + package (runs tests first via prepack)
```

### 4. Release Packaging
To create a release package, use the Stream Deck CLI:
```bash
npm run pack
```
This runs `prepack` (test + lint), then `build`, then `streamdeck pack` to produce a `.streamDeckPlugin` file in `dist/`.

**Never skip tests before packaging.** The `prepack` script enforces this.

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

## How to Add a New Action

1. **Create** `src/actions/<action-name>.ts` with a class extending `SingletonAction`.
2. **Register** the action in `src/plugin.ts`.
3. **Add** the action to `com.pedrofuentes.cloudflare-utilities.sdPlugin/manifest.json`.
4. **Create** `com.pedrofuentes.cloudflare-utilities.sdPlugin/ui/<action-name>.html` if the action needs settings.
5. **Add** icon SVGs in `com.pedrofuentes.cloudflare-utilities.sdPlugin/imgs/actions/`.
6. **Write tests** in `tests/actions/<action-name>.test.ts`.
7. **Update** `README.md` to document the new action.

## How to Add a New Service

1. **Create** `src/services/<service-name>.ts`.
2. **Define types** in `src/types/` if introducing new data shapes.
3. **Write tests** in `tests/services/<service-name>.test.ts`.
4. **Mock external calls** using `vi.fn()` / `vi.stubGlobal()` — never make real HTTP calls in tests.

## Testing Guidelines

### Mocking

- Use `vi.stubGlobal("fetch", mockFetch)` for HTTP calls.
- Use `vi.fn()` for function mocks.
- Use `vi.spyOn()` when you need to observe calls to existing methods.
- Reset mocks in `beforeEach`.

### Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ComponentName", () => {
  describe("methodName", () => {
    it("should handle happy path", () => { /* ... */ });
    it("should handle empty input", () => { /* ... */ });
    it("should handle error conditions", () => { /* ... */ });
    it("should handle edge cases", () => { /* ... */ });
  });
});
```

### What to Test

- ✅ Return values for all input variations
- ✅ Error throwing and error messages
- ✅ HTTP error status codes (400, 401, 403, 404, 429, 500, 502, 503)
- ✅ Network failures (fetch rejection)
- ✅ JSON parse failures
- ✅ Empty/null/undefined inputs
- ✅ Boundary values
- ✅ Type correctness for API response shapes

## Documentation Updates

Whenever you make changes that affect the project:
- Update `README.md` (features, scripts, structure, etc.)
- Update `CONTRIBUTING.md` if development workflow changes.
- Update this file (`AGENTS.md`) if architecture or conventions change.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(actions): add zone analytics action
fix(services): handle API rate limiting
test(services): add timeout edge case tests
docs(readme): add zone analytics documentation
```

## Environment

- No `.env` files are committed. API keys should be stored in Stream Deck action settings.
- The Cloudflare Status API (`https://www.cloudflarestatus.com/api/v2`) is public and requires no authentication.
- Future Cloudflare API endpoints will require user-provided API tokens stored in action settings.
