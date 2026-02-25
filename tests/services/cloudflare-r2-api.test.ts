/**
 * Tests for the Cloudflare R2 Storage API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareR2Api } from "../../src/services/cloudflare-r2-api";
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

describe("CloudflareR2Api", () => {
  let client: CloudflareR2Api;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareR2Api(
      "test-token",
      "test-account-id",
      "https://mock-api.test",
      "https://mock-graphql.test"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── listBuckets ───────────────────────────────────────────────────────

  describe("listBuckets", () => {
    it("should return sorted list of buckets", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: {
          buckets: [
            { name: "media", creation_date: "2025-01-01T00:00:00Z" },
            { name: "assets", creation_date: "2025-01-01T00:00:00Z" },
          ],
        },
      });

      const buckets = await client.listBuckets();
      expect(buckets).toHaveLength(2);
      expect(buckets[0].name).toBe("assets");
      expect(buckets[1].name).toBe("media");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.listBuckets()).rejects.toThrow(
        "Failed to fetch R2 buckets: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Bad request" }],
        messages: [],
        result: { buckets: [] },
      });
      await expect(client.listBuckets()).rejects.toThrow(
        "Cloudflare API error: Bad request"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));
      await expect(client.listBuckets()).rejects.toThrow("Network down");
    });

    it("should handle missing buckets array", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: {},
      });
      const buckets = await client.listBuckets();
      expect(buckets).toHaveLength(0);
    });
  });

  // ── getMetrics ────────────────────────────────────────────────────────

  describe("getMetrics", () => {
    it("should return storage and operations metrics", async () => {
      // First call: storage GraphQL
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              r2StorageAdaptiveGroups: [{
                max: { objectCount: 1000, payloadSize: 5000000, metadataSize: 50000 },
              }],
            }],
          },
        },
      });
      // Second call: operations GraphQL
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              r2OperationsAdaptiveGroups: [
                { sum: { requests: 500 }, dimensions: { actionType: "PutObject" } },
                { sum: { requests: 2000 }, dimensions: { actionType: "GetObject" } },
              ],
            }],
          },
        },
      });

      const metrics = await client.getMetrics("my-bucket", "24h");
      expect(metrics.objectCount).toBe(1000);
      expect(metrics.payloadSize).toBe(5000000);
      expect(metrics.classAOps).toBe(500);
      expect(metrics.classBOps).toBe(2000);
    });

    it("should return zeros when no data", async () => {
      mockOkFetch({
        data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [] }] } },
      });
      mockOkFetch({
        data: { viewer: { accounts: [{ r2OperationsAdaptiveGroups: [] }] } },
      });

      const metrics = await client.getMetrics("my-bucket", "7d");
      expect(metrics.objectCount).toBe(0);
      expect(metrics.payloadSize).toBe(0);
      expect(metrics.classAOps).toBe(0);
      expect(metrics.classBOps).toBe(0);
    });

    it("should classify HeadObject as class B", async () => {
      mockOkFetch({
        data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [{ max: { objectCount: 0, payloadSize: 0, metadataSize: 0 } }] }] } },
      });
      mockOkFetch({
        data: {
          viewer: {
            accounts: [{
              r2OperationsAdaptiveGroups: [
                { sum: { requests: 100 }, dimensions: { actionType: "HeadObject" } },
                { sum: { requests: 200 }, dimensions: { actionType: "DeleteObject" } },
              ],
            }],
          },
        },
      });

      const metrics = await client.getMetrics("my-bucket", "24h");
      expect(metrics.classBOps).toBe(100);
      expect(metrics.classAOps).toBe(200);
    });

    it("should throw RateLimitError on 429 for storage fetch", async () => {
      mock429Fetch("30");
      await expect(client.getMetrics("my-bucket", "24h")).rejects.toThrow(RateLimitError);
    });

    it("should throw on storage GraphQL error", async () => {
      mockOkFetch({ data: null, errors: [{ message: "Query failed" }] });
      mockOkFetch({ data: { viewer: { accounts: [{ r2OperationsAdaptiveGroups: [] }] } } });
      await expect(client.getMetrics("my-bucket", "24h")).rejects.toThrow(
        "GraphQL error: Query failed"
      );
    });

    it("should throw on operations GraphQL error", async () => {
      mockOkFetch({
        data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [{ max: { objectCount: 0, payloadSize: 0, metadataSize: 0 } }] }] } },
      });
      mockOkFetch({ data: null, errors: [{ message: "Operations failed" }] });
      await expect(client.getMetrics("my-bucket", "24h")).rejects.toThrow(
        "GraphQL error: Operations failed"
      );
    });

    it("should throw on HTTP error from GraphQL", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getMetrics("my-bucket", "24h")).rejects.toThrow(
        "GraphQL request failed: HTTP 500 Internal Server Error"
      );
    });
  });

  // ── timeRangeToDate ───────────────────────────────────────────────────

  describe("timeRangeToDate", () => {
    const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

    it("should calculate 24h ago", () => {
      const date = CloudflareR2Api.timeRangeToDate("24h", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 24 * 60 * 60 * 1000);
    });

    it("should calculate 7d ago", () => {
      const date = CloudflareR2Api.timeRangeToDate("7d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 168 * 60 * 60 * 1000);
    });

    it("should calculate 30d ago", () => {
      const date = CloudflareR2Api.timeRangeToDate("30d", fixedNow);
      expect(date.getTime()).toBe(fixedNow - 720 * 60 * 60 * 1000);
    });
  });
});
