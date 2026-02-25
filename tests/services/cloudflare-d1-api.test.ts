/**
 * Tests for the Cloudflare D1 Database API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareD1Api } from "../../src/services/cloudflare-d1-api";
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

describe("CloudflareD1Api", () => {
  let client: CloudflareD1Api;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareD1Api(
      "test-token",
      "test-account-id",
      "https://mock-api.test",
      "https://mock-graphql.test"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── listDatabases ─────────────────────────────────────────────────────

  describe("listDatabases", () => {
    it("should return sorted list of databases", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          { uuid: "db-2", name: "production", version: "beta", num_tables: 5, file_size: 1024, created_at: "2025-01-01T00:00:00Z" },
          { uuid: "db-1", name: "analytics", version: "beta", num_tables: 3, file_size: 512, created_at: "2025-01-01T00:00:00Z" },
        ],
      });

      const databases = await client.listDatabases();
      expect(databases).toHaveLength(2);
      expect(databases[0].name).toBe("analytics");
      expect(databases[1].name).toBe("production");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.listDatabases()).rejects.toThrow(
        "Failed to fetch D1 databases: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Bad request" }],
        messages: [],
        result: [],
      });
      await expect(client.listDatabases()).rejects.toThrow(
        "Cloudflare API error: Bad request"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network unavailable"));
      await expect(client.listDatabases()).rejects.toThrow("Network unavailable");
    });

    it("should handle empty result", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [],
      });
      const databases = await client.listDatabases();
      expect(databases).toHaveLength(0);
    });
  });

  // ── getAnalytics ──────────────────────────────────────────────────────

  describe("getAnalytics", () => {
    it("should return analytics metrics", async () => {
      // GraphQL response (no max field)
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              d1AnalyticsAdaptiveGroups: [{
                sum: {
                  readQueries: 5000,
                  writeQueries: 200,
                  rowsRead: 15000,
                  rowsWritten: 600,
                },
              }],
            }],
          },
        },
      });
      // REST response for database size
      mockOkFetch({
        success: true,
        result: { uuid: "db-123", name: "my-db", version: "beta", num_tables: 3, file_size: 2048000, created_at: "2025-01-01T00:00:00Z" },
      });

      const metrics = await client.getAnalytics("db-123", "24h");
      expect(metrics.readQueries).toBe(5000);
      expect(metrics.writeQueries).toBe(200);
      expect(metrics.rowsRead).toBe(15000);
      expect(metrics.rowsWritten).toBe(600);
      expect(metrics.databaseSizeBytes).toBe(2048000);
    });

    it("should return zeros when no data", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{ d1AnalyticsAdaptiveGroups: [] }],
          },
        },
      });

      const metrics = await client.getAnalytics("db-123", "7d");
      expect(metrics.readQueries).toBe(0);
      expect(metrics.writeQueries).toBe(0);
      expect(metrics.rowsRead).toBe(0);
      expect(metrics.rowsWritten).toBe(0);
      expect(metrics.databaseSizeBytes).toBe(0);
    });

    it("should handle null sum values", async () => {
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              d1AnalyticsAdaptiveGroups: [{
                sum: null,
              }],
            }],
          },
        },
      });
      // REST fallback for db size — also returns 0
      mockErrorFetch(404, "Not Found");

      const metrics = await client.getAnalytics("db-123", "30d");
      expect(metrics.readQueries).toBe(0);
      expect(metrics.writeQueries).toBe(0);
      expect(metrics.rowsRead).toBe(0);
      expect(metrics.rowsWritten).toBe(0);
      expect(metrics.databaseSizeBytes).toBe(0);
    });

    it("should send correct GraphQL variables", async () => {
      const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();
      vi.spyOn(Date, "now").mockReturnValue(fixedNow);

      mockOkFetch({
        data: {
          viewer: {
            accounts: [{ d1AnalyticsAdaptiveGroups: [] }],
          },
        },
      });

      await client.getAnalytics("db-xyz", "7d");

      // First call is GraphQL
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.variables.accountTag).toBe("test-account-id");
      expect(body.variables.dbId).toBe("db-xyz");
      expect(body.variables.since).toBe("2025-06-08");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getAnalytics("db-123", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on GraphQL error", async () => {
      mockOkFetch({
        data: null,
        errors: [{ message: "Invalid query" }],
      });
      await expect(client.getAnalytics("db-123", "24h")).rejects.toThrow(
        "GraphQL error: Invalid query"
      );
    });

    it("should throw RateLimitError on 429", async () => {
      mock429Fetch("60");
      await expect(client.getAnalytics("db-123", "24h")).rejects.toThrow(
        RateLimitError
      );
    });

    it("should throw RateLimitError without retry-after header", async () => {
      mock429Fetch();
      const error = await client.getAnalytics("db-123", "24h").catch((e) => e);
      expect(error).toBeInstanceOf(RateLimitError);
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection reset"));
      await expect(client.getAnalytics("db-123", "24h")).rejects.toThrow(
        "Connection reset"
      );
    });

    it("should return 0 for databaseSizeBytes when REST call fails", async () => {
      // GraphQL succeeds
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              d1AnalyticsAdaptiveGroups: [{
                sum: { readQueries: 100, writeQueries: 10, rowsRead: 500, rowsWritten: 50 },
              }],
            }],
          },
        },
      });
      // REST fails
      mockErrorFetch(500, "Internal Server Error");

      const metrics = await client.getAnalytics("db-123", "24h");
      expect(metrics.readQueries).toBe(100);
      expect(metrics.databaseSizeBytes).toBe(0);
    });
  });

  // ── getDatabase ───────────────────────────────────────────────────────

  describe("getDatabase", () => {
    it("should return database details", async () => {
      mockOkFetch({
        success: true,
        result: { uuid: "db-123", name: "my-db", version: "beta", num_tables: 5, file_size: 2048, created_at: "2025-01-01T00:00:00Z" },
      });

      const db = await client.getDatabase("db-123");
      expect(db.name).toBe("my-db");
      expect(db.file_size).toBe(2048);
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(404, "Not Found");
      await expect(client.getDatabase("db-missing")).rejects.toThrow(
        "Failed to fetch D1 database: HTTP 404 Not Found"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ message: "Database not found" }],
      });
      await expect(client.getDatabase("db-bad")).rejects.toThrow(
        "Cloudflare API error: Database not found"
      );
    });
  });

  // ── timeRangeToDate ───────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareD1Api.timeRangeToDate("24h", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 24 * 60 * 60 * 1000);
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareD1Api.timeRangeToDate("7d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 168 * 60 * 60 * 1000);
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareD1Api.timeRangeToDate("30d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 720 * 60 * 60 * 1000);
    });
  });
});
