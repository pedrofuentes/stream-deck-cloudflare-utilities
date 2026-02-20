/**
 * Tests for the Cloudflare Workers API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflareWorkersApi,
  formatTimeAgo,
  truncateWorkerName,
} from "../../src/services/cloudflare-workers-api";
import type {
  WorkerDeployment,
  WorkerDeploymentsApiResponse,
  WorkerVersionsApiResponse,
} from "../../src/types/cloudflare-workers";

// Mock the global fetch function
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeployment(overrides?: Partial<WorkerDeployment>): WorkerDeployment {
  return {
    id: "dep-1",
    created_on: "2025-01-15T12:00:00Z",
    source: "wrangler",
    strategy: "percentage",
    versions: [{ version_id: "v-1", percentage: 100 }],
    ...overrides,
  };
}

function makeDeploymentsResponse(
  deployments: WorkerDeployment[],
  success = true,
  errors: Array<{ code: number; message: string }> = []
): WorkerDeploymentsApiResponse {
  return {
    success,
    errors,
    messages: [],
    result: { deployments },
  };
}

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

// ── CloudflareWorkersApi ─────────────────────────────────────────────────────

describe("CloudflareWorkersApi", () => {
  let client: CloudflareWorkersApi;

  beforeEach(() => {
    client = new CloudflareWorkersApi("test-token", "test-account-id", "https://mock-api.test");
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default base URL when none provided", () => {
      const defaultClient = new CloudflareWorkersApi("token", "acc-id");
      expect(defaultClient).toBeDefined();
    });

    it("should accept a custom base URL", () => {
      const customClient = new CloudflareWorkersApi("token", "acc-id", "https://custom.test");
      expect(customClient).toBeDefined();
    });
  });

  // ── getDeployments ───────────────────────────────────────────────────────

  describe("getDeployments", () => {
    it("should return deployments when API responds successfully", async () => {
      const deployment = makeDeployment();
      mockOkFetch(makeDeploymentsResponse([deployment]));

      const result = await client.getDeployments("my-worker");

      expect(result).toEqual([deployment]);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/workers/scripts/my-worker/deployments",
        {
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
        }
      );
    });

    it("should return empty array when no deployments exist", async () => {
      mockOkFetch(makeDeploymentsResponse([]));

      const result = await client.getDeployments("my-worker");

      expect(result).toEqual([]);
    });

    it("should return multiple deployments in order", async () => {
      const dep1 = makeDeployment({ id: "dep-1", created_on: "2025-01-15T12:00:00Z" });
      const dep2 = makeDeployment({ id: "dep-2", created_on: "2025-01-14T12:00:00Z" });
      mockOkFetch(makeDeploymentsResponse([dep1, dep2]));

      const result = await client.getDeployments("my-worker");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("dep-1");
      expect(result[1].id).toBe("dep-2");
    });

    it("should encode the script name in the URL", async () => {
      mockOkFetch(makeDeploymentsResponse([]));

      await client.getDeployments("my worker/script");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/workers/scripts/my%20worker%2Fscript/deployments",
        expect.any(Object)
      );
    });

    it("should throw on HTTP 401 Unauthorized", async () => {
      mockErrorFetch(401, "Unauthorized");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 401 Unauthorized'
      );
    });

    it("should throw on HTTP 403 Forbidden", async () => {
      mockErrorFetch(403, "Forbidden");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 403 Forbidden'
      );
    });

    it("should throw on HTTP 404 Not Found", async () => {
      mockErrorFetch(404, "Not Found");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 404 Not Found'
      );
    });

    it("should throw on HTTP 429 Too Many Requests", async () => {
      mockErrorFetch(429, "Too Many Requests");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 429 Too Many Requests'
      );
    });

    it("should throw on HTTP 500 Internal Server Error", async () => {
      mockErrorFetch(500, "Internal Server Error");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 500 Internal Server Error'
      );
    });

    it("should throw on HTTP 502 Bad Gateway", async () => {
      mockErrorFetch(502, "Bad Gateway");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 502 Bad Gateway'
      );
    });

    it("should throw on HTTP 503 Service Unavailable", async () => {
      mockErrorFetch(503, "Service Unavailable");

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        'Failed to fetch deployments for "my-worker": HTTP 503 Service Unavailable'
      );
    });

    it("should throw when network request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getDeployments("my-worker")).rejects.toThrow("Network error");
    });

    it("should throw when JSON parsing fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      await expect(client.getDeployments("my-worker")).rejects.toThrow("Unexpected token");
    });

    it("should throw when API returns success: false with errors", async () => {
      mockOkFetch(
        makeDeploymentsResponse([], false, [
          { code: 10000, message: "Authentication error" },
        ])
      );

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        "Cloudflare API error: Authentication error"
      );
    });

    it("should throw with 'Unknown API error' when success is false and no errors provided", async () => {
      mockOkFetch({
        success: false,
        errors: [],
        messages: [],
        result: { deployments: [] },
      });

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        "Cloudflare API error: Unknown API error"
      );
    });

    it("should concatenate multiple API error messages", async () => {
      mockOkFetch(
        makeDeploymentsResponse([], false, [
          { code: 10000, message: "Bad token" },
          { code: 10001, message: "Missing scope" },
        ])
      );

      await expect(client.getDeployments("my-worker")).rejects.toThrow(
        "Cloudflare API error: Bad token, Missing scope"
      );
    });
  });

  // ── getLatestDeployment ──────────────────────────────────────────────────

  describe("getLatestDeployment", () => {
    it("should return the first deployment", async () => {
      const dep = makeDeployment({ id: "latest-dep" });
      mockOkFetch(makeDeploymentsResponse([dep, makeDeployment({ id: "older-dep" })]));

      const result = await client.getLatestDeployment("my-worker");

      expect(result).toBeDefined();
      expect(result!.id).toBe("latest-dep");
    });

    it("should return null when no deployments exist", async () => {
      mockOkFetch(makeDeploymentsResponse([]));

      const result = await client.getLatestDeployment("my-worker");

      expect(result).toBeNull();
    });

    it("should propagate errors from getDeployments", async () => {
      mockErrorFetch(500, "Internal Server Error");

      await expect(client.getLatestDeployment("my-worker")).rejects.toThrow(
        "HTTP 500 Internal Server Error"
      );
    });
  });

  // ── getVersions ──────────────────────────────────────────────────────────

  describe("getVersions", () => {
    it("should return versions when API responds successfully", async () => {
      const versionsResponse: WorkerVersionsApiResponse = {
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: "v-1",
            number: 1,
            metadata: {
              created_by: "user@example.com",
              source: "wrangler",
              created_on: "2025-01-15T12:00:00Z",
              modified_on: "2025-01-15T12:00:00Z",
            },
          },
        ],
      };

      mockOkFetch(versionsResponse);

      const result = await client.getVersions("my-worker");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("v-1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/workers/scripts/my-worker/versions",
        {
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
        }
      );
    });

    it("should return empty array when no versions exist", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [],
      });

      const result = await client.getVersions("my-worker");

      expect(result).toEqual([]);
    });

    it("should throw on HTTP 401 Unauthorized", async () => {
      mockErrorFetch(401, "Unauthorized");

      await expect(client.getVersions("my-worker")).rejects.toThrow(
        'Failed to fetch versions for "my-worker": HTTP 401 Unauthorized'
      );
    });

    it("should throw on HTTP 500 Internal Server Error", async () => {
      mockErrorFetch(500, "Internal Server Error");

      await expect(client.getVersions("my-worker")).rejects.toThrow(
        'Failed to fetch versions for "my-worker": HTTP 500 Internal Server Error'
      );
    });

    it("should throw when API returns success: false", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 10000, message: "Invalid token" }],
        messages: [],
        result: [],
      });

      await expect(client.getVersions("my-worker")).rejects.toThrow(
        "Cloudflare API error: Invalid token"
      );
    });

    it("should throw when network request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("DNS resolution failed"));

      await expect(client.getVersions("my-worker")).rejects.toThrow("DNS resolution failed");
    });

    it("should encode the script name in the versions URL", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });

      await client.getVersions("my worker");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/workers/scripts/my%20worker/versions",
        expect.any(Object)
      );
    });

    it("should handle version with optional message and tag", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: "v-1",
            number: 1,
            metadata: {
              created_by: "user@example.com",
              source: "wrangler",
              created_on: "2025-01-15T12:00:00Z",
              modified_on: "2025-01-15T12:00:00Z",
              message: "Deploy fix for rate limiting",
              tag: "v1.2.3",
            },
          },
        ],
      });

      const result = await client.getVersions("my-worker");

      expect(result[0].metadata.message).toBe("Deploy fix for rate limiting");
      expect(result[0].metadata.tag).toBe("v1.2.3");
    });
  });

  // ── getDeploymentStatus ──────────────────────────────────────────────────

  describe("getDeploymentStatus", () => {
    it("should return processed status for a live deployment", async () => {
      const dep = makeDeployment({
        id: "dep-live",
        created_on: "2025-01-15T12:00:00Z",
        source: "wrangler",
        versions: [{ version_id: "v-1", percentage: 100 }],
      });
      mockOkFetch(makeDeploymentsResponse([dep]));

      const result = await client.getDeploymentStatus("my-worker");

      expect(result).toBeDefined();
      expect(result!.isLive).toBe(true);
      expect(result!.isGradual).toBe(false);
      expect(result!.versionSplit).toBe("100");
      expect(result!.source).toBe("wrangler");
      expect(result!.deploymentId).toBe("dep-live");
    });

    it("should return null when no deployments exist", async () => {
      mockOkFetch(makeDeploymentsResponse([]));

      const result = await client.getDeploymentStatus("my-worker");

      expect(result).toBeNull();
    });

    it("should return status for a gradual rollout", async () => {
      const dep = makeDeployment({
        versions: [
          { version_id: "v-1", percentage: 60 },
          { version_id: "v-2", percentage: 40 },
        ],
      });
      mockOkFetch(makeDeploymentsResponse([dep]));

      const result = await client.getDeploymentStatus("my-worker");

      expect(result!.isGradual).toBe(true);
      expect(result!.isLive).toBe(false);
      expect(result!.versionSplit).toBe("60/40");
    });

    it("should propagate errors from the API", async () => {
      mockErrorFetch(403, "Forbidden");

      await expect(client.getDeploymentStatus("my-worker")).rejects.toThrow("HTTP 403 Forbidden");
    });
  });

  // ── toDeploymentStatus (static) ──────────────────────────────────────────

  describe("toDeploymentStatus", () => {
    it("should mark single 100% version as live", () => {
      const dep = makeDeployment({
        versions: [{ version_id: "v-1", percentage: 100 }],
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.isLive).toBe(true);
      expect(status.isGradual).toBe(false);
      expect(status.versionSplit).toBe("100");
    });

    it("should mark single non-100% version as not live", () => {
      const dep = makeDeployment({
        versions: [{ version_id: "v-1", percentage: 50 }],
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.isLive).toBe(false);
      expect(status.isGradual).toBe(false);
      expect(status.versionSplit).toBe("50");
    });

    it("should mark multiple versions as gradual", () => {
      const dep = makeDeployment({
        versions: [
          { version_id: "v-1", percentage: 70 },
          { version_id: "v-2", percentage: 30 },
        ],
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.isGradual).toBe(true);
      expect(status.isLive).toBe(false);
      expect(status.versionSplit).toBe("70/30");
    });

    it("should handle three-way version split", () => {
      const dep = makeDeployment({
        versions: [
          { version_id: "v-1", percentage: 50 },
          { version_id: "v-2", percentage: 30 },
          { version_id: "v-3", percentage: 20 },
        ],
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.isGradual).toBe(true);
      expect(status.versionSplit).toBe("50/30/20");
    });

    it("should handle empty versions array", () => {
      const dep = makeDeployment({ versions: [] });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.isLive).toBe(false);
      expect(status.isGradual).toBe(false);
      expect(status.versionSplit).toBe("0");
    });

    it("should extract deployment message from annotations", () => {
      const dep = makeDeployment({
        annotations: { "workers/message": "Hotfix for #123" },
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.message).toBe("Hotfix for #123");
    });

    it("should return undefined message when no annotations", () => {
      const dep = makeDeployment({ annotations: undefined });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.message).toBeUndefined();
    });

    it("should return undefined message when annotations lack workers/message", () => {
      const dep = makeDeployment({
        annotations: { "workers/tag": "v1.0" },
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.message).toBeUndefined();
    });

    it("should preserve createdOn, source, and deploymentId", () => {
      const dep = makeDeployment({
        id: "dep-abc",
        created_on: "2025-06-01T09:30:00Z",
        source: "dashboard",
      });

      const status = CloudflareWorkersApi.toDeploymentStatus(dep);

      expect(status.createdOn).toBe("2025-06-01T09:30:00Z");
      expect(status.source).toBe("dashboard");
      expect(status.deploymentId).toBe("dep-abc");
    });
  });

  // ── listWorkers ──────────────────────────────────────────────────────────

  describe("listWorkers", () => {
    it("should fetch and return workers sorted alphabetically", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          { id: "worker-c", created_on: "2025-01-01T00:00:00Z", modified_on: "2025-01-01T00:00:00Z" },
          { id: "worker-a", created_on: "2025-01-01T00:00:00Z", modified_on: "2025-01-01T00:00:00Z" },
          { id: "worker-b", created_on: "2025-01-01T00:00:00Z", modified_on: "2025-01-01T00:00:00Z" },
        ],
      });

      const workers = await client.listWorkers();

      expect(workers).toHaveLength(3);
      expect(workers[0].id).toBe("worker-a");
      expect(workers[1].id).toBe("worker-b");
      expect(workers[2].id).toBe("worker-c");
    });

    it("should call the correct URL", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });

      await client.listWorkers();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mock-api.test/accounts/test-account-id/workers/scripts",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("should return empty array when no workers exist", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });

      const workers = await client.listWorkers();

      expect(workers).toEqual([]);
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(403, "Forbidden");

      await expect(client.listWorkers()).rejects.toThrow(
        "Failed to fetch workers: HTTP 403 Forbidden"
      );
    });

    it("should throw on API error (success=false)", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 10000, message: "Authentication error" }],
        messages: [],
        result: [],
      });

      await expect(client.listWorkers()).rejects.toThrow(
        "Cloudflare API error: Authentication error"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.listWorkers()).rejects.toThrow("Network error");
    });

    it("should use custom base URL", async () => {
      const customClient = new CloudflareWorkersApi(
        "tok",
        "acc",
        "https://custom.api.test"
      );

      mockOkFetch({ success: true, errors: [], messages: [], result: [] });

      await customClient.listWorkers();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.api.test/accounts/acc/workers/scripts",
        expect.anything()
      );
    });
  });
});

// ── formatTimeAgo ────────────────────────────────────────────────────────────

describe("formatTimeAgo", () => {
  // Fixed "now" for deterministic tests: 2025-01-15T12:00:00.000Z
  const NOW = new Date("2025-01-15T12:00:00Z").getTime();

  it("should return seconds for very recent times", () => {
    const thirtySecsAgo = new Date("2025-01-15T11:59:30Z").toISOString();
    expect(formatTimeAgo(thirtySecsAgo, NOW)).toBe("30s");
  });

  it("should return '0s' for exactly now", () => {
    const now = new Date("2025-01-15T12:00:00Z").toISOString();
    expect(formatTimeAgo(now, NOW)).toBe("0s");
  });

  it("should return minutes", () => {
    const fiveMinAgo = new Date("2025-01-15T11:55:00Z").toISOString();
    expect(formatTimeAgo(fiveMinAgo, NOW)).toBe("5m");
  });

  it("should return hours", () => {
    const threeHoursAgo = new Date("2025-01-15T09:00:00Z").toISOString();
    expect(formatTimeAgo(threeHoursAgo, NOW)).toBe("3h");
  });

  it("should return days", () => {
    const twoDaysAgo = new Date("2025-01-13T12:00:00Z").toISOString();
    expect(formatTimeAgo(twoDaysAgo, NOW)).toBe("2d");
  });

  it("should return weeks", () => {
    const twoWeeksAgo = new Date("2025-01-01T12:00:00Z").toISOString();
    expect(formatTimeAgo(twoWeeksAgo, NOW)).toBe("2w");
  });

  it("should return '??' for invalid date string", () => {
    expect(formatTimeAgo("not-a-date", NOW)).toBe("??");
  });

  it("should return '??' for empty string", () => {
    expect(formatTimeAgo("", NOW)).toBe("??");
  });

  it("should return 'now' for a future date", () => {
    const future = new Date("2025-01-16T12:00:00Z").toISOString();
    expect(formatTimeAgo(future, NOW)).toBe("now");
  });

  it("should use Date.now() by default when now parameter is not provided", () => {
    // Use a date far enough in the past that it's consistent regardless of when the test runs
    const longAgo = new Date("2020-01-01T00:00:00Z").toISOString();
    const result = formatTimeAgo(longAgo);
    // Should return weeks (it's been many weeks since Jan 2020)
    expect(result).toMatch(/^\d+w$/);
  });

  it("should return '1m' at the 60-second boundary", () => {
    const sixtySecsAgo = new Date("2025-01-15T11:59:00Z").toISOString();
    expect(formatTimeAgo(sixtySecsAgo, NOW)).toBe("1m");
  });

  it("should return '1h' at the 60-minute boundary", () => {
    const sixtyMinsAgo = new Date("2025-01-15T11:00:00Z").toISOString();
    expect(formatTimeAgo(sixtyMinsAgo, NOW)).toBe("1h");
  });

  it("should return '1d' at the 24-hour boundary", () => {
    const twentyFourHoursAgo = new Date("2025-01-14T12:00:00Z").toISOString();
    expect(formatTimeAgo(twentyFourHoursAgo, NOW)).toBe("1d");
  });

  it("should return '1w' at the 7-day boundary", () => {
    const sevenDaysAgo = new Date("2025-01-08T12:00:00Z").toISOString();
    expect(formatTimeAgo(sevenDaysAgo, NOW)).toBe("1w");
  });
});

// ── truncateWorkerName ───────────────────────────────────────────────────────

describe("truncateWorkerName", () => {
  it("should return empty string for empty input", () => {
    expect(truncateWorkerName("")).toBe("");
  });

  it("should return empty string for undefined-like empty input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(truncateWorkerName(undefined as any)).toBe("");
  });

  it("should return the name unchanged when shorter than maxLength", () => {
    expect(truncateWorkerName("worker")).toBe("worker");
  });

  it("should return the name unchanged when exactly maxLength", () => {
    expect(truncateWorkerName("12345678")).toBe("12345678");
  });

  it("should truncate when name exceeds maxLength", () => {
    expect(truncateWorkerName("my-long-worker-name")).toBe("my-long-");
  });

  it("should respect a custom maxLength", () => {
    expect(truncateWorkerName("my-worker", 4)).toBe("my-w");
  });

  it("should handle maxLength of 1", () => {
    expect(truncateWorkerName("worker", 1)).toBe("w");
  });

  it("should return full name when maxLength is larger than name", () => {
    expect(truncateWorkerName("abc", 20)).toBe("abc");
  });

  it("should handle single-character name", () => {
    expect(truncateWorkerName("a")).toBe("a");
  });
});
