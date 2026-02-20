import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflareAiGatewayApi,
  formatCompactNumber,
  formatCost,
  RateLimitError,
} from "../../src/services/cloudflare-ai-gateway-api";
import type {
  AiGatewayListResponse,
  AiGatewayLogsResponse,
  AiGatewayGraphQLResponse,
} from "../../src/types/cloudflare-ai-gateway";

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

function makeGatewayListResponse(
  gateways: Array<{ id: string; name: string }>,
  success = true,
  errors: Array<{ code: number; message: string }> = []
): AiGatewayListResponse {
  return {
    success,
    errors,
    messages: [],
    result: gateways.map((g) => ({
      id: g.id,
      account_id: "acc-1",
      account_tag: "tag-1",
      name: g.name,
      created_at: "2025-01-01T00:00:00Z",
      modified_at: "2025-01-01T00:00:00Z",
    })),
  };
}

function makeLogsResponse(
  totalCount: number,
  success = true,
  errors: Array<{ code: number; message: string }> = []
): AiGatewayLogsResponse {
  return {
    success,
    errors,
    messages: [],
    result: [],
    result_info: {
      total_count: totalCount,
      count: 0,
      page: 1,
      per_page: 1,
    },
  };
}

function makeGraphQLResponse(
  metrics: { requests: number; tokensIn: number; tokensOut: number; cost: number; errors: number },
  hasErrors = false
): AiGatewayGraphQLResponse {
  const base: AiGatewayGraphQLResponse = {
    data: {
      viewer: {
        accounts: [
          {
            aiGatewayRequestsAdaptiveGroups: [
              {
                count: metrics.requests,
                sum: {
                  cost: metrics.cost,
                  erroredRequests: metrics.errors,
                  cachedTokensIn: 0,
                  cachedTokensOut: 0,
                  uncachedTokensIn: metrics.tokensIn,
                  uncachedTokensOut: metrics.tokensOut,
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

// ── CloudflareAiGatewayApi ───────────────────────────────────────────────────

describe("CloudflareAiGatewayApi", () => {
  let client: CloudflareAiGatewayApi;

  beforeEach(() => {
    client = new CloudflareAiGatewayApi(
      "test-token",
      "test-account-id",
      "https://mock-api.test",
      "https://mock-graphql.test"
    );
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── constructor ────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should use default base URL when none provided", () => {
      const defaultClient = new CloudflareAiGatewayApi("token", "acc-id");
      expect(defaultClient).toBeDefined();
    });

    it("should accept custom URLs", () => {
      const customClient = new CloudflareAiGatewayApi(
        "token",
        "acc-id",
        "https://custom.test",
        "https://custom-gql.test"
      );
      expect(customClient).toBeDefined();
    });
  });

  // ── listGateways ───────────────────────────────────────────────────────

  describe("listGateways", () => {
    it("should return gateways sorted alphabetically by id", async () => {
      mockOkFetch(
        makeGatewayListResponse([
          { id: "zebra-gw", name: "Zebra" },
          { id: "alpha-gw", name: "Alpha" },
          { id: "mid-gw", name: "Mid" },
        ])
      );

      const gateways = await client.listGateways();

      expect(gateways).toHaveLength(3);
      expect(gateways[0].id).toBe("alpha-gw");
      expect(gateways[1].id).toBe("mid-gw");
      expect(gateways[2].id).toBe("zebra-gw");
    });

    it("should return empty array when no gateways exist", async () => {
      mockOkFetch(makeGatewayListResponse([]));
      const gateways = await client.listGateways();
      expect(gateways).toEqual([]);
    });

    it("should send correct Authorization header", async () => {
      mockOkFetch(makeGatewayListResponse([]));
      await client.listGateways();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/ai-gateway/gateways",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.listGateways()).rejects.toThrow(
        "Failed to fetch gateways: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on HTTP 401", async () => {
      mockErrorFetch(401, "Unauthorized");
      await expect(client.listGateways()).rejects.toThrow(
        "Failed to fetch gateways: HTTP 401 Unauthorized"
      );
    });

    it("should throw on HTTP 403", async () => {
      mockErrorFetch(403, "Forbidden");
      await expect(client.listGateways()).rejects.toThrow(
        "Failed to fetch gateways: HTTP 403 Forbidden"
      );
    });

    it("should throw on HTTP 404", async () => {
      mockErrorFetch(404, "Not Found");
      await expect(client.listGateways()).rejects.toThrow(
        "Failed to fetch gateways: HTTP 404 Not Found"
      );
    });

    it("should throw on HTTP 429 rate limit", async () => {
      mockErrorFetch(429, "Too Many Requests");
      await expect(client.listGateways()).rejects.toThrow(
        "Failed to fetch gateways: HTTP 429 Too Many Requests"
      );
    });

    it("should throw on API-level error (success=false)", async () => {
      mockOkFetch(
        makeGatewayListResponse([], false, [
          { code: 10000, message: "Authentication error" },
        ])
      );
      await expect(client.listGateways()).rejects.toThrow(
        "Cloudflare API error: Authentication error"
      );
    });

    it("should throw with fallback message when API errors array is empty", async () => {
      mockOkFetch({
        success: false,
        errors: [],
        messages: [],
        result: [],
      });
      await expect(client.listGateways()).rejects.toThrow(
        "Cloudflare API error: Unknown API error"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await expect(client.listGateways()).rejects.toThrow("Network error");
    });
  });

  // ── getLogsCount ───────────────────────────────────────────────────────

  describe("getLogsCount", () => {
    it("should return the total_count from result_info", async () => {
      mockOkFetch(makeLogsResponse(42_000));
      const count = await client.getLogsCount("my-gateway");
      expect(count).toBe(42_000);
    });

    it("should return 0 when result_info is missing", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [],
      });
      const count = await client.getLogsCount("my-gateway");
      expect(count).toBe(0);
    });

    it("should return 0 when total_count is 0", async () => {
      mockOkFetch(makeLogsResponse(0));
      const count = await client.getLogsCount("my-gateway");
      expect(count).toBe(0);
    });

    it("should URL-encode the gateway ID", async () => {
      mockOkFetch(makeLogsResponse(10));
      await client.getLogsCount("my gateway/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("my%20gateway%2Ftest"),
        expect.any(Object)
      );
    });

    it("should include per_page=1 and meta_info=true in URL", async () => {
      mockOkFetch(makeLogsResponse(10));
      await client.getLogsCount("gw-1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("per_page=1&meta_info=true"),
        expect.any(Object)
      );
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(502, "Bad Gateway");
      await expect(client.getLogsCount("gw-1")).rejects.toThrow(
        "Failed to fetch log count: HTTP 502 Bad Gateway"
      );
    });

    it("should throw on HTTP 503", async () => {
      mockErrorFetch(503, "Service Unavailable");
      await expect(client.getLogsCount("gw-1")).rejects.toThrow(
        "Failed to fetch log count: HTTP 503 Service Unavailable"
      );
    });

    it("should throw on API-level error (success=false)", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 7003, message: "Gateway not found" }],
        messages: [],
        result: [],
      });
      await expect(client.getLogsCount("gw-1")).rejects.toThrow(
        "Cloudflare API error: Gateway not found"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(client.getLogsCount("gw-1")).rejects.toThrow("fetch failed");
    });

    it("should throw RateLimitError on HTTP 429", async () => {
      mock429Fetch("120");
      await expect(client.getLogsCount("gw-1")).rejects.toThrow(RateLimitError);
    });

    it("should parse Retry-After header on 429", async () => {
      mock429Fetch("120");
      try {
        await client.getLogsCount("gw-1");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(120);
      }
    });

    it("should default to 60s retry on 429 without Retry-After header", async () => {
      mock429Fetch();
      try {
        await client.getLogsCount("gw-1");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(60);
      }
    });
  });

  // ── getAnalytics ───────────────────────────────────────────────────────

  describe("getAnalytics", () => {
    it("should return analytics for 24h range", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 1500,
          tokensIn: 50_000,
          tokensOut: 30_000,
          cost: 4.52,
          errors: 3,
        })
      );

      const result = await client.getAnalytics("gw-1", "24h");

      expect(result.requests).toBe(1500);
      expect(result.tokensIn).toBe(50_000);
      expect(result.tokensOut).toBe(30_000);
      expect(result.cost).toBe(4.52);
      expect(result.errors).toBe(3);
    });

    it("should return zeros when no data returned", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                aiGatewayRequestsAdaptiveGroups: [],
              },
            ],
          },
        },
      });

      const result = await client.getAnalytics("gw-1", "7d");

      expect(result.requests).toBe(0);
      expect(result.tokensIn).toBe(0);
      expect(result.tokensOut).toBe(0);
      expect(result.cost).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("should return zeros when accounts array is empty", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [],
          },
        },
      });

      const result = await client.getAnalytics("gw-1", "30d");

      expect(result.requests).toBe(0);
      expect(result.tokensIn).toBe(0);
      expect(result.tokensOut).toBe(0);
      expect(result.cost).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("should handle null values in sum with fallback to 0", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                aiGatewayRequestsAdaptiveGroups: [
                  {
                    count: null,
                    sum: {
                      cost: null,
                      erroredRequests: null,
                      cachedTokensIn: null,
                      cachedTokensOut: null,
                      uncachedTokensIn: null,
                      uncachedTokensOut: null,
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      const result = await client.getAnalytics("gw-1", "24h");

      expect(result.requests).toBe(0);
      expect(result.tokensIn).toBe(0);
      expect(result.tokensOut).toBe(0);
      expect(result.cost).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("should send POST request with correct body", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          errors: 0,
        })
      );

      await client.getAnalytics("my-gw", "24h");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-graphql.test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("my-gw"),
        })
      );
    });

    it("should include the account tag in variables", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          errors: 0,
        })
      );

      await client.getAnalytics("gw-1", "24h");

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.variables.accountTag).toBe("test-account-id");
      expect(callBody.variables.gateway).toBe("gw-1");
      expect(callBody.variables.since).toBeDefined();
      // Should be a date string (YYYY-MM-DD), not a full ISO datetime
      expect(callBody.variables.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getAnalytics("gw-1", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on GraphQL error", async () => {
      mockOkFetch(
        makeGraphQLResponse(
          { requests: 0, tokensIn: 0, tokensOut: 0, cost: 0, errors: 0 },
          true
        )
      );
      await expect(client.getAnalytics("gw-1", "24h")).rejects.toThrow(
        "GraphQL error: Some GraphQL error"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(client.getAnalytics("gw-1", "24h")).rejects.toThrow(
        "Connection refused"
      );
    });

    it("should throw RateLimitError on HTTP 429", async () => {
      mock429Fetch("90");
      await expect(client.getAnalytics("gw-1", "24h")).rejects.toThrow(RateLimitError);
    });

    it("should parse Retry-After header on GraphQL 429", async () => {
      mock429Fetch("45");
      try {
        await client.getAnalytics("gw-1", "24h");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfterSeconds).toBe(45);
      }
    });

    it("should use 7d time range (168 hours)", async () => {
      const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();
      const date = CloudflareAiGatewayApi.timeRangeToDate("7d", fixedNow);
      const expectedDate = new Date(fixedNow - 168 * 60 * 60 * 1000);
      expect(date.getTime()).toBe(expectedDate.getTime());
    });

    it("should use 30d time range (720 hours)", async () => {
      const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();
      const date = CloudflareAiGatewayApi.timeRangeToDate("30d", fixedNow);
      const expectedDate = new Date(fixedNow - 720 * 60 * 60 * 1000);
      expect(date.getTime()).toBe(expectedDate.getTime());
    });
  });

  // ── getMetrics ─────────────────────────────────────────────────────────

  describe("getMetrics", () => {
    it("should combine analytics and log count", async () => {
      // First call: GraphQL analytics
      mockOkFetch(
        makeGraphQLResponse({
          requests: 1000,
          tokensIn: 25_000,
          tokensOut: 15_000,
          cost: 2.5,
          errors: 5,
        })
      );
      // Second call: REST log count
      mockOkFetch(makeLogsResponse(8_000));

      const metrics = await client.getMetrics("gw-1", "24h");

      expect(metrics.requests).toBe(1000);
      expect(metrics.tokens).toBe(40_000); // 25000 + 15000
      expect(metrics.tokensIn).toBe(25_000);
      expect(metrics.tokensOut).toBe(15_000);
      expect(metrics.cost).toBe(2.5);
      expect(metrics.errors).toBe(5);
      expect(metrics.logsStored).toBe(8_000);
    });

    it("should make two parallel API calls", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          errors: 0,
        })
      );
      mockOkFetch(makeLogsResponse(0));

      await client.getMetrics("gw-1", "24h");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should propagate analytics error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      mockOkFetch(makeLogsResponse(100));

      await expect(client.getMetrics("gw-1", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should propagate log count error", async () => {
      mockOkFetch(
        makeGraphQLResponse({
          requests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          errors: 0,
        })
      );
      mockErrorFetch(500, "Internal Server Error");

      await expect(client.getMetrics("gw-1", "24h")).rejects.toThrow();
    });
  });

  // ── timeRangeToDate ────────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const NOW = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareAiGatewayApi.timeRangeToDate("24h", NOW);
      const expected = new Date(NOW - 24 * 60 * 60 * 1000);
      expect(date.toISOString()).toBe(expected.toISOString());
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareAiGatewayApi.timeRangeToDate("7d", NOW);
      const expected = new Date(NOW - 7 * 24 * 60 * 60 * 1000);
      expect(date.toISOString()).toBe(expected.toISOString());
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareAiGatewayApi.timeRangeToDate("30d", NOW);
      const expected = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
      expect(date.toISOString()).toBe(expected.toISOString());
    });

    it("should use current time when now parameter is not provided", () => {
      const before = Date.now();
      const date = CloudflareAiGatewayApi.timeRangeToDate("24h");
      const after = Date.now();

      // The result should be approximately 24h before now
      const expectedMin = before - 24 * 60 * 60 * 1000;
      const expectedMax = after - 24 * 60 * 60 * 1000;
      expect(date.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(date.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });
});

// ── formatCompactNumber ──────────────────────────────────────────────────────

describe("formatCompactNumber", () => {
  it("should format 0", () => {
    expect(formatCompactNumber(0)).toBe("0");
  });

  it("should format small numbers as-is", () => {
    expect(formatCompactNumber(42)).toBe("42");
  });

  it("should format 999 as-is", () => {
    expect(formatCompactNumber(999)).toBe("999");
  });

  it("should format 1000 as 1K", () => {
    expect(formatCompactNumber(1000)).toBe("1K");
  });

  it("should format 1234 as 1.2K", () => {
    expect(formatCompactNumber(1234)).toBe("1.2K");
  });

  it("should format 10500 as 10.5K", () => {
    expect(formatCompactNumber(10_500)).toBe("10.5K");
  });

  it("should format 100000 as 100K", () => {
    expect(formatCompactNumber(100_000)).toBe("100K");
  });

  it("should format 999999 as 1000K", () => {
    expect(formatCompactNumber(999_999)).toBe("1000K");
  });

  it("should format 1000000 as 1M", () => {
    expect(formatCompactNumber(1_000_000)).toBe("1M");
  });

  it("should format 1234567 as 1.2M", () => {
    expect(formatCompactNumber(1_234_567)).toBe("1.2M");
  });

  it("should format 100000000 as 100M", () => {
    expect(formatCompactNumber(100_000_000)).toBe("100M");
  });

  it("should format 1000000000 as 1B", () => {
    expect(formatCompactNumber(1_000_000_000)).toBe("1B");
  });

  it("should format 1500000000 as 1.5B", () => {
    expect(formatCompactNumber(1_500_000_000)).toBe("1.5B");
  });

  it("should format negative numbers", () => {
    expect(formatCompactNumber(-1234)).toBe("-1.2K");
  });

  it("should round small numbers", () => {
    expect(formatCompactNumber(42.7)).toBe("43");
  });

  it("should format 100_000_000_000 as 100B", () => {
    expect(formatCompactNumber(100_000_000_000)).toBe("100B");
  });
});

// ── formatCost ───────────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("should format 0 as $0", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("should format very small values as $0", () => {
    expect(formatCost(0.001)).toBe("$0");
    expect(formatCost(0.009)).toBe("$0");
  });

  it("should format 0.05 as $0.05", () => {
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("should format 0.01 as $0.01", () => {
    expect(formatCost(0.01)).toBe("$0.01");
  });

  it("should format 4.523 as $4.52", () => {
    expect(formatCost(4.523)).toBe("$4.52");
  });

  it("should format 10 as $10", () => {
    expect(formatCost(10)).toBe("$10");
  });

  it("should format 100 as $100", () => {
    expect(formatCost(100)).toBe("$100");
  });

  it("should format 999.99 as $999.99", () => {
    expect(formatCost(999.99)).toBe("$999.99");
  });

  it("should format 1000 as $1K", () => {
    expect(formatCost(1000)).toBe("$1K");
  });

  it("should format 1234 as $1.2K", () => {
    expect(formatCost(1234)).toBe("$1.2K");
  });

  it("should format negative cost", () => {
    expect(formatCost(-4.52)).toBe("-$4.52");
  });

  it("should strip trailing .00 for whole numbers", () => {
    expect(formatCost(5.0)).toBe("$5");
  });

  it("should keep decimals for non-whole numbers", () => {
    expect(formatCost(5.1)).toBe("$5.10");
  });
});
