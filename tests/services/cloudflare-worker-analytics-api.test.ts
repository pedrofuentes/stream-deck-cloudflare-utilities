/**
 * Tests for the Cloudflare Worker Analytics API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflareWorkerAnalyticsApi,
  formatDuration,
} from "../../src/services/cloudflare-worker-analytics-api";
import { RateLimitError } from "../../src/services/cloudflare-ai-gateway-api";
import type { WorkerAnalyticsGraphQLResponse } from "../../src/types/cloudflare-worker-analytics";

// Mock the global fetch function
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockOkFetch(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockErrorFetch(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  });
}

function mock429Fetch(retryAfter?: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      get: (name: string) => (name === "Retry-After" ? (retryAfter ?? null) : null),
    },
  });
}

function makeGraphQLResponse(
  metrics: {
    requests?: number;
    errors?: number;
    subrequests?: number;
    wallTime?: number;
    cpuTimeP50?: number;
    cpuTimeP99?: number;
  },
  hasErrors = false
): WorkerAnalyticsGraphQLResponse {
  const base: WorkerAnalyticsGraphQLResponse = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              {
                sum: {
                  requests: metrics.requests ?? 0,
                  errors: metrics.errors ?? 0,
                  subrequests: metrics.subrequests ?? 0,
                  wallTime: metrics.wallTime ?? 0,
                },
                quantiles: {
                  cpuTimeP50: metrics.cpuTimeP50 ?? 0,
                  cpuTimeP99: metrics.cpuTimeP99 ?? 0,
                },
              },
            ],
          },
        ],
      },
    },
  };
  if (hasErrors) {
    base.errors = [{ message: "Some GraphQL error" }];
  }
  return base;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CloudflareWorkerAnalyticsApi", () => {
  let client: CloudflareWorkerAnalyticsApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareWorkerAnalyticsApi(
      "test-token",
      "test-account-id",
      "https://mock-graphql.test"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── getAnalytics ─────────────────────────────────────────────────────

  describe("getAnalytics", () => {
    it("should return analytics for 24h range", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 5000,
          errors: 23,
          subrequests: 1200,
          wallTime: 150_000,
          cpuTimeP50: 2300,
          cpuTimeP99: 45000,
        })
      );

      const result = await client.getAnalytics("my-worker", "24h");

      expect(result.requests).toBe(5000);
      expect(result.errors).toBe(23);
      expect(result.subrequests).toBe(1200);
      expect(result.wallTime).toBe(150_000);
      expect(result.cpuTimeP50).toBe(2300);
      expect(result.cpuTimeP99).toBe(45000);
    });

    it("should return zeros when no data returned", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [],
              },
            ],
          },
        },
      });

      const result = await client.getAnalytics("my-worker", "7d");

      expect(result.requests).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.subrequests).toBe(0);
      expect(result.wallTime).toBe(0);
      expect(result.cpuTimeP50).toBe(0);
      expect(result.cpuTimeP99).toBe(0);
    });

    it("should return zeros when accounts array is empty", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [],
          },
        },
      });

      const result = await client.getAnalytics("my-worker", "30d");

      expect(result.requests).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("should handle null values with fallback to 0", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [
                  {
                    sum: {
                      requests: null,
                      errors: null,
                      subrequests: null,
                      wallTime: null,
                    },
                    quantiles: {
                      cpuTimeP50: null,
                      cpuTimeP99: null,
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      const result = await client.getAnalytics("my-worker", "24h");

      expect(result.requests).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.subrequests).toBe(0);
      expect(result.wallTime).toBe(0);
      expect(result.cpuTimeP50).toBe(0);
      expect(result.cpuTimeP99).toBe(0);
    });

    it("should aggregate across multiple groups", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [
                  {
                    sum: { requests: 100, errors: 5, subrequests: 10, wallTime: 1000 },
                    quantiles: { cpuTimeP50: 500, cpuTimeP99: 2000 },
                  },
                  {
                    sum: { requests: 200, errors: 3, subrequests: 20, wallTime: 2000 },
                    quantiles: { cpuTimeP50: 800, cpuTimeP99: 3000 },
                  },
                ],
              },
            ],
          },
        },
      });

      const result = await client.getAnalytics("my-worker", "24h");

      expect(result.requests).toBe(300);
      expect(result.errors).toBe(8);
      expect(result.subrequests).toBe(30);
      expect(result.wallTime).toBe(3000);
      // Quantiles take max across groups
      expect(result.cpuTimeP50).toBe(800);
      expect(result.cpuTimeP99).toBe(3000);
    });

    it("should send POST request with correct body", async () => {
      mockOkFetch(makeGraphQLResponse({}));

      await client.getAnalytics("my-worker", "24h");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-graphql.test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("my-worker"),
        })
      );
    });

    it("should include the account tag and script name in variables", async () => {
      mockOkFetch(makeGraphQLResponse({}));

      await client.getAnalytics("my-worker", "24h");

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.variables.accountTag).toBe("test-account-id");
      expect(callBody.variables.scriptName).toBe("my-worker");
      expect(callBody.variables.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getAnalytics("my-worker", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on GraphQL error", async () => {
      mockOkFetch(makeGraphQLResponse({}, true));
      await expect(client.getAnalytics("my-worker", "24h")).rejects.toThrow(
        "GraphQL error: Some GraphQL error"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(client.getAnalytics("my-worker", "24h")).rejects.toThrow(
        "Connection refused"
      );
    });

    it("should throw RateLimitError on HTTP 429", async () => {
      mock429Fetch("90");
      await expect(client.getAnalytics("my-worker", "24h")).rejects.toThrow(
        RateLimitError
      );
    });

    it("should parse Retry-After header on 429", async () => {
      mock429Fetch("45");
      try {
        await client.getAnalytics("my-worker", "24h");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(45);
      }
    });

    it("should default to 60s retry on 429 without Retry-After header", async () => {
      mock429Fetch();
      try {
        await client.getAnalytics("my-worker", "24h");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(60);
      }
    });
  });

  // ── timeRangeToDate ────────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareWorkerAnalyticsApi.timeRangeToDate("24h", fixedNow);
      const expected = new Date(fixedNow - 24 * 60 * 60 * 1000);
      expect(date.getTime()).toBe(expected.getTime());
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareWorkerAnalyticsApi.timeRangeToDate("7d", fixedNow);
      const expected = new Date(fixedNow - 168 * 60 * 60 * 1000);
      expect(date.getTime()).toBe(expected.getTime());
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareWorkerAnalyticsApi.timeRangeToDate("30d", fixedNow);
      const expected = new Date(fixedNow - 720 * 60 * 60 * 1000);
      expect(date.getTime()).toBe(expected.getTime());
    });

    it("should use current time when now parameter is not provided", () => {
      const before = Date.now();
      const date = CloudflareWorkerAnalyticsApi.timeRangeToDate("24h");
      const after = Date.now();
      const expectedMin = before - 24 * 60 * 60 * 1000;
      const expectedMax = after - 24 * 60 * 60 * 1000;
      expect(date.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(date.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });
});

// ── formatDuration ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("should format 0 as 0ms", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("should format small microsecond values", () => {
    expect(formatDuration(500)).toBe("500μs");
  });

  it("should format exactly 1μs", () => {
    expect(formatDuration(1)).toBe("1μs");
  });

  it("should format 999μs", () => {
    expect(formatDuration(999)).toBe("999μs");
  });

  it("should format 1000μs as 1ms", () => {
    expect(formatDuration(1000)).toBe("1ms");
  });

  it("should format milliseconds with one decimal", () => {
    expect(formatDuration(2300)).toBe("2.3ms");
  });

  it("should format 10.5ms", () => {
    expect(formatDuration(10500)).toBe("10.5ms");
  });

  it("should format 100ms without decimal", () => {
    expect(formatDuration(100_000)).toBe("100ms");
  });

  it("should format 999ms", () => {
    expect(formatDuration(999_000)).toBe("999ms");
  });

  it("should format 1000ms as 1s", () => {
    expect(formatDuration(1_000_000)).toBe("1s");
  });

  it("should format 1.5s", () => {
    expect(formatDuration(1_500_000)).toBe("1.5s");
  });

  it("should format 120s", () => {
    expect(formatDuration(120_000_000)).toBe("120s");
  });

  it("should format negative values with minus sign", () => {
    expect(formatDuration(-2300)).toBe("-2.3ms");
  });

  it("should strip trailing .0 from milliseconds", () => {
    expect(formatDuration(5000)).toBe("5ms");
  });

  it("should strip trailing .0 from seconds", () => {
    expect(formatDuration(2_000_000)).toBe("2s");
  });
});
