# Testing Protocol — Stream Deck Cloudflare Utilities

> **Audience**: AI agents and developers writing or reviewing tests for this plugin.
> This document defines the testing strategy, patterns, and recipes accumulated
> from building and maintaining this project. Every pattern has been validated
> in practice.

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Commands](#2-commands)
3. [Test Structure & Organization](#3-test-structure--organization)
4. [Mocking Patterns](#4-mocking-patterns)
5. [Testing Actions (Stream Deck Integration)](#5-testing-actions-stream-deck-integration)
6. [Testing Services (Business Logic)](#6-testing-services-business-logic)
7. [Testing the Key Image Renderer](#7-testing-the-key-image-renderer)
8. [Timer & Async Testing](#8-timer--async-testing)
9. [Marquee Testing](#9-marquee-testing)
10. [Error & Edge Case Coverage](#10-error--edge-case-coverage)
11. [HTTP & Network Error Testing](#11-http--network-error-testing)
12. [SVG Assertion Helpers](#12-svg-assertion-helpers)
13. [Coverage Requirements](#13-coverage-requirements)
14. [Pre-Release Testing Protocol](#14-pre-release-testing-protocol)
15. [Common Pitfalls](#15-common-pitfalls)
16. [Test Recipe Catalog](#16-test-recipe-catalog)

---

## 1. Testing Philosophy

- **Every change MUST include tests.** No exceptions.
- **All tests MUST pass before any commit, merge, or deploy.**
- **Edge cases are mandatory**: empty inputs, error states, network failures, unexpected data shapes, boundary values.
- **No real HTTP calls**: All `fetch` calls are mocked. Tests must be fast and deterministic.
- **Tests mirror source structure**: `src/actions/foo.ts` → `tests/actions/foo.test.ts`.
- **Coverage thresholds**: 80% branches, functions, lines, statements.

---

## 2. Commands

```bash
npm test              # Run all tests (must pass before every commit)
npm run test:watch    # Watch mode during development
npm run test:coverage # Generate coverage report with thresholds
```

### When to Run

| Event | Command |
|-------|---------|
| Before every commit | `npm test` |
| During development | `npm run test:watch` |
| Before a release | `npm test && npm run lint && npm run build && npm run validate` |
| After adding new code | `npm run test:coverage` to check coverage |

---

## 3. Test Structure & Organization

### File Layout

```
tests/
├── actions/
│   ├── ai-gateway-metric.test.ts      # 85 tests
│   ├── cloudflare-status.test.ts       # 46 tests
│   ├── worker-analytics.test.ts        # 44 tests
│   └── worker-deployment-status.test.ts # 66 tests
├── services/
│   ├── cloudflare-ai-gateway-api.test.ts    # 75 tests
│   ├── cloudflare-api-client.test.ts        # 23 tests
│   ├── cloudflare-worker-analytics-api.test.ts # 32 tests
│   ├── cloudflare-workers-api.test.ts       # 72 tests
│   ├── global-settings-store.test.ts        # 20 tests
│   ├── key-image-renderer.test.ts           # 41 tests
│   └── marquee-controller.test.ts           # 34 tests
└── types/
    └── cloudflare.test.ts                   # 8 tests
```

### Test File Template

```typescript
/**
 * Tests for ComponentName.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MyComponent } from "../../src/path/to/component";

// Mocks go here (module-level)

describe("MyComponent", () => {
  let component: MyComponent;

  beforeEach(() => {
    component = new MyComponent();
    // Reset mocks
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("methodName", () => {
    it("should handle happy path", () => { /* ... */ });
    it("should handle empty input", () => { /* ... */ });
    it("should handle error conditions", () => { /* ... */ });
    it("should handle edge cases", () => { /* ... */ });
  });
});
```

### Naming Convention

- `describe` blocks: Component name → method name → scenario group
- `it` blocks: `"should <expected behavior>"` — always start with "should"
- Group related tests under nested `describe` blocks

---

## 4. Mocking Patterns

### Mock `fetch` (HTTP calls)

```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// Success response
mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ data: "value" }),
});

// Error response
mockFetch.mockResolvedValueOnce({
  ok: false,
  status: 429,
  statusText: "Too Many Requests",
  headers: { get: (key: string) => key === "Retry-After" ? "60" : null },
});

// Network failure
mockFetch.mockRejectedValueOnce(new Error("Network error"));
```

### Mock the Stream Deck SDK

Every action test file needs this at the top:

```typescript
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      setLevel: vi.fn(),
    },
    actions: {
      registerAction: vi.fn(),
    },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));
```

### Mock Stream Deck Events

```typescript
function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
      showOk: vi.fn().mockResolvedValue(undefined),
      showAlert: vi.fn().mockResolvedValue(undefined),
      getSettings: vi.fn().mockResolvedValue(settings),
    },
  } as any;
}
```

### Mock External APIs via Class Mocking

```typescript
// Mock the module
vi.mock("../../src/services/cloudflare-workers-api", () => ({
  CloudflareWorkersApi: vi.fn().mockImplementation(() => ({
    getDeploymentStatus: mockGetDeploymentStatus,
  })),
}));

// Track with external reference
let mockGetDeploymentStatus = vi.fn();

beforeEach(() => {
  mockGetDeploymentStatus = vi.fn();
  // Re-wire the mock
  vi.mocked(CloudflareWorkersApi).mockImplementation(() => ({
    getDeploymentStatus: mockGetDeploymentStatus,
  } as any));
});
```

### Mock Global Settings Store

```typescript
import { getGlobalSettings } from "../../src/services/global-settings-store";

vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn().mockReturnValue({ apiToken: "tok", accountId: "acc" }),
  onGlobalSettingsChanged: vi.fn(),
}));
```

### Use `vi.fn()` for Simple Mocks

```typescript
const callback = vi.fn();
myObject.doSomething(callback);
expect(callback).toHaveBeenCalledWith("expected-arg");
expect(callback).toHaveBeenCalledTimes(1);
```

### Use `vi.spyOn()` for Existing Methods

```typescript
const spy = vi.spyOn(myObject, "method");
myObject.doSomething();
expect(spy).toHaveBeenCalled();
spy.mockRestore();
```

---

## 5. Testing Actions (Stream Deck Integration)

Actions are the most complex to test because they integrate with the SDK, services, timers, and UI rendering.

### Standard Action Test Pattern

```typescript
describe("MyAction", () => {
  let action: MyAction;

  beforeEach(() => {
    action = new MyAction();
    vi.restoreAllMocks();
  });

  describe("onWillAppear", () => {
    it("should render the key when action appears", async () => {
      const ev = makeMockEvent({ workerName: "my-worker" });
      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show placeholder when not configured", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });
  });

  describe("onKeyDown", () => {
    it("should cycle metrics on key press", async () => { /* ... */ });
  });

  describe("onWillDisappear", () => {
    it("should clean up timers", () => { /* ... */ });
  });
});
```

### What to Test in Actions

- [ ] `onWillAppear` renders correctly with valid settings
- [ ] `onWillAppear` shows placeholder with missing/empty settings
- [ ] `onDidReceiveSettings` updates display when settings change
- [ ] `onKeyDown` triggers expected behavior (metric cycling, refresh, etc.)
- [ ] `onWillDisappear` cleans up all timers and intervals
- [ ] Polling intervals fire and update the display
- [ ] Error states display gracefully
- [ ] Global settings changes re-initialize API clients
- [ ] Marquee starts for long names, stops for short names
- [ ] Marquee cleans up on disappear

---

## 6. Testing Services (Business Logic)

Services are plain TypeScript classes with no SDK dependencies — straightforward to test.

### Standard Service Test Pattern

```typescript
describe("CloudflareApiClient", () => {
  let client: CloudflareApiClient;

  beforeEach(() => {
    client = new CloudflareApiClient("https://mock-api.test/api/v2");
    mockFetch.mockReset();
  });

  describe("getSystemStatus", () => {
    it("should return status on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: { indicator: "none" } }),
      });
      const result = await client.getSystemStatus();
      expect(result.indicator).toBe("none");
    });

    it("should throw on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
      await expect(client.getSystemStatus()).rejects.toThrow();
    });
  });
});
```

### What to Test in Services

- [ ] Success responses with valid data
- [ ] HTTP error codes: 400, 401, 403, 404, 429, 500, 502, 503
- [ ] Network failures (`fetch` rejection)
- [ ] JSON parse failures
- [ ] Empty/null/undefined inputs
- [ ] Boundary values (zero, negative, max)
- [ ] Rate limiting (429 with `Retry-After` header)
- [ ] Correct URL construction
- [ ] Correct HTTP headers (Authorization, Content-Type)
- [ ] Response data transformation/mapping

---

## 7. Testing the Key Image Renderer

### SVG Output Assertions

```typescript
describe("renderKeyImage", () => {
  it("should render a valid SVG data URI", () => {
    const result = renderKeyImage({
      line1: "test",
      line2: "OK",
      statusColor: STATUS_COLORS.green,
    });
    expect(result).toMatch(/^data:image\/svg\+xml,/);
  });

  it("should include the status color in the accent bar", () => {
    const svg = decodeSvg(renderKeyImage({
      line2: "OK",
      statusColor: STATUS_COLORS.green,
    }));
    expect(svg).toContain(STATUS_COLORS.green);
  });

  it("should XML-escape special characters", () => {
    const svg = decodeSvg(renderKeyImage({
      line1: "A & B <C>",
      line2: "OK",
      statusColor: STATUS_COLORS.green,
    }));
    expect(svg).toContain("A &amp; B &lt;C&gt;");
    expect(svg).not.toContain("A & B <C>"); // raw chars would break SVG
  });
});
```

---

## 8. Timer & Async Testing

Vitest's fake timers are essential for testing polling, marquee, and backoff behavior.

### Setup

```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-15T12:00:00Z")); // pin system time if needed
});

afterEach(() => {
  vi.useRealTimers();
});
```

### Advancing Timers

```typescript
// Advance by specific duration (handles async operations like Promises)
await vi.advanceTimersByTimeAsync(60_000); // advance 60 seconds

// Run all pending timers
await vi.runAllTimersAsync();

// Run only the next timer
await vi.runOnlyPendingTimersAsync();
```

### Testing Polling

```typescript
it("should poll at the configured interval", async () => {
  vi.useFakeTimers();
  const ev = makeMockEvent({ refreshIntervalSeconds: 60 });
  await action.onWillAppear(ev);

  const initialCalls = ev.action.setImage.mock.calls.length;

  // Advance past one polling interval
  await vi.advanceTimersByTimeAsync(61_000);

  // Should have re-rendered
  expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(initialCalls);

  vi.useRealTimers();
});
```

### Testing Cleanup

```typescript
it("should stop polling on disappear", async () => {
  vi.useFakeTimers();
  const ev = makeMockEvent({ refreshIntervalSeconds: 60 });
  await action.onWillAppear(ev);
  action.onWillDisappear(ev);

  const callCount = ev.action.setImage.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);

  // No more renders after disappear
  expect(ev.action.setImage.mock.calls.length).toBe(callCount);

  vi.useRealTimers();
});
```

### Critical: Always Restore Real Timers

Fake timers leak between tests if not restored. **Always** call `vi.useRealTimers()` in `afterEach` or at the end of each test that uses fake timers.

---

## 9. Marquee Testing

### Test That Short Names Don't Trigger Marquee

```typescript
it("should not start marquee for short names", async () => {
  vi.useFakeTimers();
  mockApiCall.mockResolvedValue({ name: "my-api" }); // 6 chars, under 10-char limit

  const ev = makeMockEvent({ name: "my-api" });
  await action.onWillAppear(ev);
  const initialCalls = ev.action.setImage.mock.calls.length;

  // Advance past marquee interval — no additional renders
  await vi.advanceTimersByTimeAsync(3000);

  const svg = decodeSvg(ev.action.setImage.mock.calls[initialCalls - 1][0]);
  expect(svg).toContain("my-api"); // full name, not truncated

  vi.useRealTimers();
});
```

### Test That Long Names Trigger Marquee

```typescript
it("should start marquee for long names", async () => {
  vi.useFakeTimers();
  const longName = "my-super-long-worker-name"; // 25 chars, over 10-char limit

  const ev = makeMockEvent({ name: longName });
  await action.onWillAppear(ev);
  const initialCalls = ev.action.setImage.mock.calls.length;

  // Advance past pause ticks (3 × 500ms) and into scrolling
  await vi.advanceTimersByTimeAsync(3000);

  // Marquee should have triggered additional re-renders
  expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(initialCalls);

  vi.useRealTimers();
});
```

### Test That Marquee Stops on Disappear

```typescript
it("should stop marquee on disappear", async () => {
  vi.useFakeTimers();
  const ev = makeMockEvent({ name: "my-super-long-worker-name" });
  await action.onWillAppear(ev);
  action.onWillDisappear(ev);

  const callCount = ev.action.setImage.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);

  // No more renders after disappear
  expect(ev.action.setImage.mock.calls.length).toBe(callCount);

  vi.useRealTimers();
});
```

---

## 10. Error & Edge Case Coverage

### Mandatory Edge Cases

Every action and service must test these scenarios:

| Category | Examples |
|----------|----------|
| **Empty inputs** | `""`, `undefined`, `null`, `{}`, `[]` |
| **Missing settings** | No worker name, no API token, no account ID |
| **Invalid settings** | Wrong types, unexpected values |
| **Boundary values** | Zero, negative numbers, max integers, empty strings |
| **Network failures** | `fetch` throws `Error("Network error")` |
| **HTTP error codes** | 400, 401, 403, 404, 429, 500, 502, 503 |
| **JSON parse failures** | Response body is not valid JSON |
| **Unexpected API shapes** | Missing fields, extra fields, wrong types |
| **Case sensitivity** | API returns lowercase; test uppercase input is handled |
| **Concurrent operations** | Multiple rapid key presses, settings changes during poll |
| **Timer cleanup** | Disappear during polling, settings change during marquee |

### Test Error Throwing

```typescript
it("should throw on HTTP 401", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  });
  await expect(client.getStatus()).rejects.toThrow("401");
});

it("should throw on network failure", async () => {
  mockFetch.mockRejectedValueOnce(new Error("Network error"));
  await expect(client.getStatus()).rejects.toThrow("Network error");
});
```

---

## 11. HTTP & Network Error Testing

### Comprehensive HTTP Status Testing

```typescript
describe("HTTP error handling", () => {
  const errorCodes = [
    { status: 400, text: "Bad Request" },
    { status: 401, text: "Unauthorized" },
    { status: 403, text: "Forbidden" },
    { status: 404, text: "Not Found" },
    { status: 429, text: "Too Many Requests" },
    { status: 500, text: "Internal Server Error" },
    { status: 502, text: "Bad Gateway" },
    { status: 503, text: "Service Unavailable" },
  ];

  for (const { status, text } of errorCodes) {
    it(`should throw on HTTP ${status}`, async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: text,
      });
      await expect(client.getData()).rejects.toThrow();
    });
  }
});
```

### Rate Limit (429) with `Retry-After`

```typescript
it("should parse Retry-After header on 429", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      get: (key: string) => (key === "Retry-After" ? "120" : null),
    },
  });

  try {
    await client.getData();
  } catch (error) {
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBe(120);
  }
});
```

---

## 12. SVG Assertion Helpers

### `decodeSvg` Helper

Every action test file should include this:

```typescript
/** Decode a data URI to the raw SVG string for assertion convenience. */
function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}
```

### Common SVG Assertions

```typescript
// Check status color in accent bar
expect(svg).toContain(STATUS_COLORS.green);

// Check text content
expect(svg).toContain("my-worker");
expect(svg).toContain("OK");

// Check that text is centered
expect(svg).toContain('text-anchor="middle"');

// Check font sizes
expect(svg).toContain('font-size="30"');
expect(svg).toContain('font-weight="bold"');

// Check XML escaping
expect(svg).toContain("&amp;");
expect(svg).not.toContain("A & B"); // raw chars break SVG
```

---

## 13. Coverage Requirements

### Thresholds

```
Branches:   80%
Functions:  80%
Lines:      80%
Statements: 80%
```

### Checking Coverage

```bash
npm run test:coverage
```

### What Counts

- Every public method must have at least one test
- Every branch (`if/else`, `switch`, `??`, `||`) must be exercised
- Error paths must be tested, not just happy paths
- Uncovered lines usually indicate missing edge case tests

---

## 14. Pre-Release Testing Protocol

### Automated Checks (Agent Runs These)

These are run before every release and must all pass:

```bash
npm test                                        # All tests pass
npm run lint                                     # No TypeScript errors
npm run build                                    # Successful Rollup build
npm run validate                                 # Stream Deck CLI validation
streamdeck restart com.pedrofuentes.cloudflare-utilities  # Plugin hot-reloads
```

### Manual Device Test (User Performs This)

**The agent MUST ask the user to test on their physical Stream Deck** before any release. The Stream Deck CLI has no automated functional testing capability:

- `streamdeck validate` → only checks manifest JSON schema
- `streamdeck restart` → only confirms plugin loads without crashing
- `streamdeck dev` → enables debug logging, but doesn't test functionality

### What to Test on Device

- [ ] All actions appear in the Stream Deck action list with correct icons
- [ ] Each action's Property Inspector loads correctly
- [ ] All dropdowns, checkboxes, and settings work in the PI
- [ ] Keys render with correct accent bar colors, text, and layout
- [ ] Polling/refresh works (data updates at the configured interval)
- [ ] Key presses cycle metrics or trigger expected behavior
- [ ] Marquee scrolling works for long names (> 10 characters)
- [ ] Error states display correctly (no credentials, bad API response)
- [ ] Long names scroll smoothly without visual artifacts

### Step-by-Step Test Flow Requirement

Agents must provide a **numbered, step-by-step manual test flow** covering every new feature or bug fix. Each step must include:

1. **Setup steps**: Add action to key, configure PI settings
2. **Happy-path verification**: Expected display, colors, values
3. **Interaction tests**: Key press behavior, metric cycling, dropdown changes
4. **Edge-case checks**: Long names for marquee, missing credentials, empty data
5. **Regression checks**: Existing actions that may be affected by the change

---

## 15. Common Pitfalls

### Pitfall 1: Fake Timers Not Restored

**Problem**: Fake timers leak into subsequent tests, causing random failures.
**Fix**: Always call `vi.useRealTimers()` in `afterEach` or at the end of each test.

### Pitfall 2: Mock Not Reset Between Tests

**Problem**: Mock state from one test bleeds into the next.
**Fix**: Call `mockFetch.mockReset()` or `vi.restoreAllMocks()` in `beforeEach`.

### Pitfall 3: Async Timer Advancement

**Problem**: `vi.advanceTimersByTime()` (sync) doesn't resolve pending Promises.
**Fix**: Use `await vi.advanceTimersByTimeAsync()` when tests involve async operations (which is almost always with actions).

### Pitfall 4: Missing Logger Mock

**Problem**: Action code calls `streamDeck.logger.info()` but the mock only has `error`.
**Fix**: Include all logger methods in the mock: `error`, `info`, `setLevel`.

### Pitfall 5: Mock Class Re-Wiring

**Problem**: `vi.mock()` creates the mock once, but tests need different return values.
**Fix**: Define `let mockMethod = vi.fn()` outside `describe`, re-wire in `beforeEach` via `vi.mocked(Class).mockImplementation(...)`.

### Pitfall 6: Overly Tight Timer Assertions

**Problem**: Tests check exact call counts after advancing timers by large amounts. Counts drift due to multiple interval interactions (polling + marquee + display refresh).
**Fix**: Use `toBeGreaterThan(previousCount)` for "it re-rendered" assertions. Use exact counts only when the test isolates one timer.

### Pitfall 7: System Time Not Pinned

**Problem**: Tests that calculate relative time ("2h ago") break on different dates.
**Fix**: Pin system time with `vi.setSystemTime(new Date("2025-01-15T12:00:00Z"))`.

---

## 16. Test Recipe Catalog

Quick-reference recipes for common testing scenarios.

### Recipe: Test Backoff After Consecutive Errors

```typescript
it("should apply exponential backoff on consecutive errors", async () => {
  vi.useFakeTimers();
  mockApi.mockRejectedValue(new Error("fail"));

  const ev = makeMockEvent({ refreshIntervalSeconds: 10 });
  await action.onWillAppear(ev);

  // First error: no skip
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mockApi).toHaveBeenCalledTimes(2); // initial + 1 poll

  // Second error: should skip 1 cycle (backoff 2^1 - 1 = 1)
  await vi.advanceTimersByTimeAsync(10_000); // skipped
  await vi.advanceTimersByTimeAsync(10_000); // fires
  expect(mockApi).toHaveBeenCalledTimes(3);

  vi.useRealTimers();
});
```

### Recipe: Test Settings Change During Active Polling

```typescript
it("should restart polling when settings change", async () => {
  vi.useFakeTimers();
  const ev = makeMockEvent({ name: "worker-1" });
  await action.onWillAppear(ev);

  // Change settings
  const ev2 = makeMockEvent({ name: "worker-2" });
  await action.onDidReceiveSettings(ev2);

  await vi.advanceTimersByTimeAsync(61_000);
  const svg = decodeSvg(ev2.action.setImage.mock.calls.at(-1)[0]);
  expect(svg).toContain("worker-2");

  vi.useRealTimers();
});
```

### Recipe: Test Global Settings Change Re-initializes API

```typescript
it("should re-initialize API client when credentials change", async () => {
  const ev = makeMockEvent({ name: "my-worker" });
  await action.onWillAppear(ev);

  // Simulate global settings change
  const callback = vi.mocked(onGlobalSettingsChanged).mock.calls[0][0];
  callback({ apiToken: "new-token", accountId: "new-account" });

  // Verify new API client was constructed with new credentials
  expect(CloudflareWorkersApi).toHaveBeenCalledWith("new-token", "new-account");
});
```

### Recipe: Test Placeholder on Unconfigured Action

```typescript
it("should show placeholder when no settings configured", async () => {
  const ev = makeMockEvent({});
  await action.onWillAppear(ev);

  const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
  expect(svg).toContain("...");
});
```

### Recipe: Test Key Press Cycles Metrics

```typescript
it("should cycle through metrics on key press", async () => {
  const ev = makeMockEvent({ name: "my-gateway" });
  await action.onWillAppear(ev);

  const firstSvg = decodeSvg(ev.action.setImage.mock.calls.at(-1)[0]);

  await action.onKeyDown(ev);
  const secondSvg = decodeSvg(ev.action.setImage.mock.calls.at(-1)[0]);

  // Different metric should be displayed
  expect(secondSvg).not.toBe(firstSvg);
});
```

---

## Updating This Document

When you discover new testing patterns or pitfalls:
1. Add to the relevant section above
2. Add pitfalls to [section 15](#15-common-pitfalls)
3. Add reusable recipes to [section 16](#16-test-recipe-catalog)
4. Reference `AGENTS.md` for project rules and `.github/UI-DESIGN-GUIDE.md` for visual specs
