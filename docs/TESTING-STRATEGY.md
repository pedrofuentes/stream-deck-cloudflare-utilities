# Testing Strategy

> Extended testing context for AI agents. Referenced from AGENTS.md.
> **The TDD mandate (tests before implementation) is enforced in AGENTS.md and verified by Sentinel.**
> This document covers the details of HOW to test.

---

## Test Types

| Type | Purpose | Location | Runner |
|------|---------|----------|--------|
| Unit | Services (API clients, renderers, formatters), pure functions | `tests/services/`, `tests/scripts/` | Vitest |
| Action | Action event handling, key rendering, settings, polling/marquee timers | `tests/actions/` | Vitest (SDK mocked) |
| Manual device (E2E) | Real key rendering, OLED colors, press/cycle behavior | physical Stream Deck | Manual — see `../.github/TESTING-PROTOCOL.md` |

## Coverage Requirements

- **Global gate**: **80%** branches / functions / lines / statements, enforced by `vitest.config.ts` thresholds.
- **Project-wide coverage**: must never decrease from the previous merge baseline.
- **Scope**: measured over `src/**/*.ts`, excluding `src/plugin.ts`, `src/types/**`, and `*.test.ts`.
- **Run coverage**: `npm run test:coverage`
- **Sentinel verifies coverage thresholds on every PR**

## Test-Only PRs

PRs that only add tests to existing (untested) code use commit type `test(scope)` and are exempt from test-first choreography ordering (there is no `feat`/`fix` to follow). Sentinel verifies the tests are meaningful and pass.

## Testing Patterns

### Mocking
Services make HTTP calls with the global `fetch`. Stub it with `vi.stubGlobal` — **never make
real network calls in tests.** Action tests additionally mock the `@elgato/streamdeck` module so
no real device/SDK is required. Use `vi.useFakeTimers()` for polling / marquee / backoff timers
and restore real timers in `afterEach`. Full recipes (timer testing, backoff, marquee, SVG
assertions) live in [`../.github/TESTING-PROTOCOL.md`](../.github/TESTING-PROTOCOL.md).

```typescript
// Mock fetch for a service test
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ status: { indicator: "none", description: "All Systems Operational" } }),
} as Response);
vi.stubGlobal("fetch", mockFetch);

const client = new CloudflareApiClient();
await expect(client.getSystemStatus()).resolves.toMatchObject({ indicator: "none" });

// Error path — always test non-2xx and network failures
mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" } as Response);
await expect(client.getSystemStatus()).rejects.toThrow(/HTTP 500/);
```

### Test Naming Convention
```typescript
describe("CloudflareApiClient", () => {
  it("should throw an error when the API responds with HTTP 500", async () => {
    // Arrange → Act → Assert
  });
});
```

### What Must Be Tested
- All public API functions
- Error paths and edge cases (not just happy paths)
- **All HTTP error codes the API can return** (400, 401, 403, 404, 429, 500, 502, 503) plus network failures and JSON-parse errors
- State transitions, metric cycling, and marquee/polling timer behavior
- Input validation and boundary conditions (empty data, missing credentials, long names)

### What Should NOT Be Tested
- Framework internals
- Third-party library behavior
- Implementation details (test behavior, not structure)

## CI Integration

- **No CI pipeline yet.** Tests run locally with `npm test` and are gated by the `prepack`
  script (`npm test && npm run lint && npm run validate:consistency`) before any package is built.
- All tests must pass before Sentinel review begins; Sentinel runs as a sub-agent (there is no CI status check).
- Flaky tests must be fixed immediately, not skipped.
- **Before any release**, a manual physical-device test is mandatory — see
  [`../.github/TESTING-PROTOCOL.md`](../.github/TESTING-PROTOCOL.md) and AGENTS.md §Stream Deck Project Rules.
