/**
 * Tests for the Cloudflare Workers KV API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareKvApi } from "../../src/services/cloudflare-kv-api";
import { RateLimitError } from "../../src/services/cloudflare-ai-gateway-api";

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CloudflareKvApi", () => {
  let client: CloudflareKvApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareKvApi(
      "test-token",
      "test-account-id",
      "https://mock-api.test",
      "https://mock-graphql.test"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── listNamespaces ────────────────────────────────────────────────────

  describe("listNamespaces", () => {
    it("should return sorted list of namespaces", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          { id: "ns-2", title: "Sessions", supports_url_encoding: true },
          { id: "ns-1", title: "Cache", supports_url_encoding: true },
        ],
      });

      const namespaces = await client.listNamespaces();
      expect(namespaces).toHaveLength(2);
      expect(namespaces[0].title).toBe("Cache");
      expect(namespaces[1].title).toBe("Sessions");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.listNamespaces()).rejects.toThrow(
        "Failed to fetch KV namespaces: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Bad request" }],
        messages: [],
        result: [],
      });
      await expect(client.listNamespaces()).rejects.toThrow(
        "Cloudflare API error: Bad request"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network unavailable"));
      await expect(client.listNamespaces()).rejects.toThrow("Network unavailable");
    });

    it("should handle empty result", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [],
      });
      const namespaces = await client.listNamespaces();
      expect(namespaces).toHaveLength(0);
    });
  });

  // ── getAnalytics ──────────────────────────────────────────────────────

  describe("getAnalytics", () => {
    function mockGraphQLResponse(groups: Array<{ actionType: string; requests: number }>) {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [
              {
                kvOperationsAdaptiveGroups: groups.map((g) => ({
                  dimensions: { actionType: g.actionType },
                  sum: { requests: g.requests },
                })),
              },
            ],
          },
        },
        errors: null,
      });
    }

    it("should return analytics metrics from GraphQL endpoint", async () => {
      mockGraphQLResponse([
        { actionType: "read", requests: 10000 },
        { actionType: "write", requests: 500 },
        { actionType: "delete", requests: 50 },
        { actionType: "list", requests: 100 },
      ]);

      const metrics = await client.getAnalytics("ns-123", "24h");
      expect(metrics.readQueries).toBe(10000);
      expect(metrics.writeQueries).toBe(500);
      expect(metrics.deleteQueries).toBe(50);
      expect(metrics.listQueries).toBe(100);
    });

    it("should return zeros when no groups returned", async () => {
      mockGraphQLResponse([]);

      const metrics = await client.getAnalytics("ns-123", "7d");
      expect(metrics.readQueries).toBe(0);
      expect(metrics.writeQueries).toBe(0);
      expect(metrics.deleteQueries).toBe(0);
      expect(metrics.listQueries).toBe(0);
    });

    it("should return zeros when accounts array is empty", async () => {
      mockOkFetch({
        data: { viewer: { accounts: [] } },
        errors: null,
      });

      const metrics = await client.getAnalytics("ns-123", "30d");
      expect(metrics.readQueries).toBe(0);
      expect(metrics.writeQueries).toBe(0);
      expect(metrics.deleteQueries).toBe(0);
      expect(metrics.listQueries).toBe(0);
    });

    it("should ignore unknown action types", async () => {
      mockGraphQLResponse([
        { actionType: "read", requests: 100 },
        { actionType: "unknown_op", requests: 999 },
      ]);

      const metrics = await client.getAnalytics("ns-123", "24h");
      expect(metrics.readQueries).toBe(100);
      expect(metrics.writeQueries).toBe(0);
      expect(metrics.deleteQueries).toBe(0);
      expect(metrics.listQueries).toBe(0);
    });

    it("should POST to the GraphQL endpoint with correct variables", async () => {
      mockGraphQLResponse([]);

      await client.getAnalytics("ns-xyz", "7d");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://mock-graphql.test");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.query).toContain("kvOperationsAdaptiveGroups");
      expect(body.variables.accountTag).toBe("test-account-id");
      expect(body.variables.namespaceId).toBe("ns-xyz");
      expect(body.variables.since).toBeDefined();
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getAnalytics("ns-123", "24h")).rejects.toThrow(
        "KV analytics request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on GraphQL error response", async () => {
      mockOkFetch({
        data: null,
        errors: [{ message: "unknown field" }],
      });
      await expect(client.getAnalytics("ns-123", "24h")).rejects.toThrow(
        "GraphQL error: unknown field"
      );
    });

    it("should throw RateLimitError on 429", async () => {
      mock429Fetch("60");
      await expect(client.getAnalytics("ns-123", "24h")).rejects.toThrow(
        RateLimitError
      );
    });

    it("should throw RateLimitError without retry-after header", async () => {
      mock429Fetch();
      const error = await client.getAnalytics("ns-123", "24h").catch((e) => e);
      expect(error).toBeInstanceOf(RateLimitError);
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection reset"));
      await expect(client.getAnalytics("ns-123", "24h")).rejects.toThrow(
        "Connection reset"
      );
    });
  });

  // ── timeRangeToDate ───────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareKvApi.timeRangeToDate("24h", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 24 * 60 * 60 * 1000);
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareKvApi.timeRangeToDate("7d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 168 * 60 * 60 * 1000);
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareKvApi.timeRangeToDate("30d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 720 * 60 * 60 * 1000);
    });
  });
});
