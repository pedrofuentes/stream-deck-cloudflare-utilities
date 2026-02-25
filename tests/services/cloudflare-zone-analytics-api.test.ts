/**
 * Tests for the Cloudflare Zone Analytics API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflareZoneAnalyticsApi,
  formatBytes,
} from "../../src/services/cloudflare-zone-analytics-api";
import { RateLimitError } from "../../src/services/cloudflare-ai-gateway-api";
import type { ZoneAnalyticsGraphQLResponse } from "../../src/types/cloudflare-zone-analytics";

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
  overrides?: {
    requests?: number;
    bytes?: number;
    cachedBytes?: number;
    threats?: number;
    uniques?: number;
  },
  hasErrors = false
): ZoneAnalyticsGraphQLResponse {
  const base: ZoneAnalyticsGraphQLResponse = {
    data: {
      viewer: {
        zones: [
          {
            httpRequests1dGroups: [
              {
                sum: {
                  requests: overrides?.requests ?? 0,
                  bytes: overrides?.bytes ?? 0,
                  cachedBytes: overrides?.cachedBytes ?? 0,
                  threats: overrides?.threats ?? 0,
                },
                uniq: {
                  uniques: overrides?.uniques ?? 0,
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

describe("CloudflareZoneAnalyticsApi", () => {
  let client: CloudflareZoneAnalyticsApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareZoneAnalyticsApi("test-token", "https://mock-graphql.test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── getAnalytics ─────────────────────────────────────────────────────

  describe("getAnalytics", () => {
    it("should return analytics for 24h range", async () => {
      mockOkFetch(makeGraphQLResponse({
        requests: 50000,
        bytes: 1024 * 1024 * 100,
        cachedBytes: 1024 * 1024 * 80,
        threats: 42,
        uniques: 1500,
      }));

      const result = await client.getAnalytics("zone-1", "24h");
      expect(result.requests).toBe(50000);
      expect(result.bandwidth).toBe(1024 * 1024 * 100);
      expect(result.cachedBytes).toBe(1024 * 1024 * 80);
      expect(result.threats).toBe(42);
      expect(result.visitors).toBe(1500);
    });

    it("should aggregate multiple day groups for multi-day range", async () => {
      mockOkFetch({
        data: {
          viewer: {
            zones: [{
              httpRequests1dGroups: [
                { sum: { requests: 100, bytes: 1000, cachedBytes: 500, threats: 2 }, uniq: { uniques: 50 } },
                { sum: { requests: 200, bytes: 2000, cachedBytes: 800, threats: 3 }, uniq: { uniques: 70 } },
                { sum: { requests: 150, bytes: 1500, cachedBytes: 600, threats: 1 }, uniq: { uniques: 60 } },
              ],
            }],
          },
        },
      });
      const result = await client.getAnalytics("zone-1", "7d");
      expect(result.requests).toBe(450);
      expect(result.bandwidth).toBe(4500);
      expect(result.cachedBytes).toBe(1900);
      expect(result.threats).toBe(6);
      expect(result.visitors).toBe(180);
    });

    it("should return zeros when no data returned", async () => {
      mockOkFetch({
        data: { viewer: { zones: [{ httpRequests1dGroups: [] }] } },
      });
      const result = await client.getAnalytics("zone-1", "7d");
      expect(result.requests).toBe(0);
      expect(result.bandwidth).toBe(0);
      expect(result.threats).toBe(0);
      expect(result.visitors).toBe(0);
    });

    it("should return zeros when zones array is empty", async () => {
      mockOkFetch({ data: { viewer: { zones: [] } } });
      const result = await client.getAnalytics("zone-1", "30d");
      expect(result.requests).toBe(0);
    });

    it("should handle null values with fallback to 0", async () => {
      mockOkFetch({
        data: {
          viewer: {
            zones: [{
              httpRequests1dGroups: [{
                sum: { requests: null, bytes: null, cachedBytes: null, threats: null },
                uniq: { uniques: null },
              }],
            }],
          },
        },
      });
      const result = await client.getAnalytics("zone-1", "24h");
      expect(result.requests).toBe(0);
      expect(result.bandwidth).toBe(0);
      expect(result.threats).toBe(0);
      expect(result.visitors).toBe(0);
    });

    it("should send POST request with correct body", async () => {
      mockOkFetch(makeGraphQLResponse({}));
      await client.getAnalytics("zone-1", "24h");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-graphql.test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
          body: expect.stringContaining("zone-1"),
        })
      );
    });

    it("should include the zone tag in variables", async () => {
      mockOkFetch(makeGraphQLResponse({}));
      await client.getAnalytics("my-zone-id", "24h");
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.variables.zoneTag).toBe("my-zone-id");
      expect(callBody.variables.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getAnalytics("zone-1", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on GraphQL error", async () => {
      mockOkFetch(makeGraphQLResponse({}, true));
      await expect(client.getAnalytics("zone-1", "24h")).rejects.toThrow(
        "GraphQL error: Some GraphQL error"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(client.getAnalytics("zone-1", "24h")).rejects.toThrow("Connection refused");
    });

    it("should throw RateLimitError on HTTP 429", async () => {
      mock429Fetch("90");
      await expect(client.getAnalytics("zone-1", "24h")).rejects.toThrow(RateLimitError);
    });

    it("should parse Retry-After header on 429", async () => {
      mock429Fetch("45");
      try {
        await client.getAnalytics("zone-1", "24h");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(45);
      }
    });

    it("should default to 60s retry on 429 without Retry-After", async () => {
      mock429Fetch();
      try {
        await client.getAnalytics("zone-1", "24h");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(60);
      }
    });
  });

  // ── timeRangeToDate ───────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareZoneAnalyticsApi.timeRangeToDate("24h", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 24 * 60 * 60 * 1000);
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareZoneAnalyticsApi.timeRangeToDate("7d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 168 * 60 * 60 * 1000);
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareZoneAnalyticsApi.timeRangeToDate("30d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 720 * 60 * 60 * 1000);
    });
  });
});

// ── formatBytes ─────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("should return 0B for zero", () => {
    expect(formatBytes(0)).toBe("0B");
  });

  it("should format bytes", () => {
    expect(formatBytes(512)).toBe("512B");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1536)).toBe("1.5KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1024 * 1024 * 5.5)).toBe("5.5MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 2.3)).toBe("2.3GB");
  });

  it("should format terabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1.5)).toBe("1.5TB");
  });

  it("should handle negative bytes", () => {
    expect(formatBytes(-1024)).toBe("-1KB");
  });

  it("should round large KB values", () => {
    expect(formatBytes(1024 * 150)).toBe("150KB");
  });

  it("should round large MB values", () => {
    expect(formatBytes(1024 * 1024 * 200)).toBe("200MB");
  });
});
