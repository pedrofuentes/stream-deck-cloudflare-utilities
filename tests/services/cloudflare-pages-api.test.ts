/**
 * Tests for the Cloudflare Pages API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflarePagesApi,
  formatTimeAgo,
  truncateProjectName,
} from "../../src/services/cloudflare-pages-api";
import type { PagesDeployment } from "../../src/types/cloudflare-pages";

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

function makeDeployment(overrides?: Partial<PagesDeployment>): PagesDeployment {
  return {
    id: "dep-1",
    short_id: "abc1234",
    project_id: "proj-1",
    project_name: "my-site",
    environment: "production",
    url: "https://my-site.pages.dev",
    created_on: "2025-06-15T12:00:00Z",
    modified_on: "2025-06-15T12:05:00Z",
    latest_stage: {
      name: "deploy",
      started_on: "2025-06-15T12:00:00Z",
      ended_on: "2025-06-15T12:05:00Z",
      status: "success",
    },
    deployment_trigger: {
      type: "ad_hoc",
      metadata: {
        branch: "main",
        commit_hash: "abc1234567890",
        commit_message: "fix: update homepage",
      },
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CloudflarePagesApi", () => {
  let client: CloudflarePagesApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflarePagesApi("test-token", "test-account-id", "https://mock-api.test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default base URL when none provided", () => {
      const defaultClient = new CloudflarePagesApi("token", "acct");
      expect(defaultClient).toBeDefined();
    });
  });

  // ── listProjects ──────────────────────────────────────────────────────

  describe("listProjects", () => {
    it("should return sorted list of projects", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          { name: "beta-site", subdomain: "beta" },
          { name: "alpha-site", subdomain: "alpha" },
        ],
      });

      const projects = await client.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe("alpha-site");
      expect(projects[1].name).toBe("beta-site");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.listProjects()).rejects.toThrow(
        "Failed to fetch Pages projects: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Bad request" }],
        messages: [],
        result: [],
      });
      await expect(client.listProjects()).rejects.toThrow(
        "Cloudflare API error: Bad request"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));
      await expect(client.listProjects()).rejects.toThrow("Network down");
    });

    it("should return empty array when no projects", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [],
      });
      const projects = await client.listProjects();
      expect(projects).toHaveLength(0);
    });

    it("should send correct authorization header", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      await client.listProjects();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/pages/projects"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });
  });

  // ── getDeployments ────────────────────────────────────────────────────

  describe("getDeployments", () => {
    it("should return deployments for project", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeDeployment()],
      });

      const deployments = await client.getDeployments("my-site");
      expect(deployments).toHaveLength(1);
      expect(deployments[0].id).toBe("dep-1");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(404, "Not Found");
      await expect(client.getDeployments("missing")).rejects.toThrow(
        'Failed to fetch deployments for "missing": HTTP 404 Not Found'
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Project not found" }],
        messages: [],
        result: [],
      });
      await expect(client.getDeployments("missing")).rejects.toThrow(
        "Cloudflare API error: Project not found"
      );
    });

    it("should URL-encode project name", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      await client.getDeployments("my site");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("my%20site"),
        expect.anything()
      );
    });
  });

  // ── getDeploymentStatus ───────────────────────────────────────────────

  describe("getDeploymentStatus", () => {
    it("should return null when no deployments exist", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      const status = await client.getDeploymentStatus("my-site");
      expect(status).toBeNull();
    });

    it("should return success status", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeDeployment()],
      });
      const status = await client.getDeploymentStatus("my-site");
      expect(status).not.toBeNull();
      expect(status!.isSuccess).toBe(true);
      expect(status!.isBuilding).toBe(false);
      expect(status!.isFailed).toBe(false);
    });

    it("should return building status", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          makeDeployment({
            latest_stage: { name: "build", started_on: "", ended_on: null, status: "active" },
          }),
        ],
      });
      const status = await client.getDeploymentStatus("my-site");
      expect(status!.isBuilding).toBe(true);
      expect(status!.isSuccess).toBe(false);
    });

    it("should return failed status", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          makeDeployment({
            latest_stage: { name: "deploy", started_on: "", ended_on: "", status: "failure" },
          }),
        ],
      });
      const status = await client.getDeploymentStatus("my-site");
      expect(status!.isFailed).toBe(true);
      expect(status!.isSuccess).toBe(false);
    });
  });

  // ── toDeploymentStatus ────────────────────────────────────────────────

  describe("toDeploymentStatus", () => {
    it("should extract branch and commit hash", () => {
      const dep = makeDeployment();
      const status = CloudflarePagesApi.toDeploymentStatus(dep);
      expect(status.branch).toBe("main");
      expect(status.commitHash).toBe("abc1234");
    });

    it("should handle missing trigger metadata", () => {
      const dep = makeDeployment({ deployment_trigger: undefined });
      const status = CloudflarePagesApi.toDeploymentStatus(dep);
      expect(status.branch).toBe("");
      expect(status.commitHash).toBe("");
    });

    it("should handle idle status as building", () => {
      const dep = makeDeployment({
        latest_stage: { name: "build", started_on: "", ended_on: null, status: "idle" },
      });
      const status = CloudflarePagesApi.toDeploymentStatus(dep);
      expect(status.isBuilding).toBe(true);
    });
  });
});

// ── formatTimeAgo ──────────────────────────────────────────────────────

describe("formatTimeAgo", () => {
  const fixedNow = new Date("2025-06-15T12:00:00Z").getTime();

  it("should show seconds for recent times", () => {
    const result = formatTimeAgo("2025-06-15T11:59:30Z", fixedNow);
    expect(result).toBe("30s ago");
  });

  it("should show minutes", () => {
    const result = formatTimeAgo("2025-06-15T11:55:00Z", fixedNow);
    expect(result).toBe("5m ago");
  });

  it("should show hours", () => {
    const result = formatTimeAgo("2025-06-15T09:00:00Z", fixedNow);
    expect(result).toBe("3h ago");
  });

  it("should show days", () => {
    const result = formatTimeAgo("2025-06-13T12:00:00Z", fixedNow);
    expect(result).toBe("2d ago");
  });

  it("should return empty string for invalid date", () => {
    expect(formatTimeAgo("invalid", fixedNow)).toBe("");
  });

  it("should return 'now' for future dates", () => {
    expect(formatTimeAgo("2025-06-16T12:00:00Z", fixedNow)).toBe("now");
  });
});

// ── truncateProjectName ─────────────────────────────────────────────────

describe("truncateProjectName", () => {
  it("should return short names unchanged", () => {
    expect(truncateProjectName("mysite")).toBe("mysite");
  });

  it("should return exactly 10 chars unchanged", () => {
    expect(truncateProjectName("0123456789")).toBe("0123456789");
  });

  it("should truncate and add ellipsis for long names", () => {
    expect(truncateProjectName("my-very-long-project")).toBe("my-very-l…");
  });

  it("should handle empty string", () => {
    expect(truncateProjectName("")).toBe("");
  });
});
