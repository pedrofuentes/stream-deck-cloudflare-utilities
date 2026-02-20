import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerDeploymentStatus } from "../../src/actions/worker-deployment-status";
import type { DeploymentStatus } from "../../src/types/cloudflare-workers";

// Mock the @elgato/streamdeck module
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
      error: vi.fn(),
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

// Track the mock instance methods so tests can configure them
let mockGetDeploymentStatus: ReturnType<typeof vi.fn>;

// Mock the CloudflareWorkersApi as a class
vi.mock("../../src/services/cloudflare-workers-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-workers-api")>();
  return {
    ...orig,
    CloudflareWorkersApi: class MockCloudflareWorkersApi {
      constructor() {
        this.getDeploymentStatus = mockGetDeploymentStatus;
      }
      getDeploymentStatus: ReturnType<typeof vi.fn>;
    },
  };
});

// Helper to create a mock SD event
function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("WorkerDeploymentStatus", () => {
  let action: WorkerDeploymentStatus;

  beforeEach(() => {
    action = new WorkerDeploymentStatus();
  });

  // ── resolveState ─────────────────────────────────────────────────────────

  describe("resolveState", () => {
    const NOW = new Date("2025-01-15T12:00:00Z").getTime();

    function makeStatus(overrides?: Partial<DeploymentStatus>): DeploymentStatus {
      return {
        isLive: true,
        isGradual: false,
        createdOn: "2025-01-15T10:00:00Z",
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
        ...overrides,
      };
    }

    it('should return "gradual" when deployment is a gradual rollout', () => {
      const status = makeStatus({ isGradual: true, isLive: false, versionSplit: "60/40" });
      expect(action.resolveState(status, NOW)).toBe("gradual");
    });

    it('should return "recent" when deployment is within 10 minutes', () => {
      const fiveMinAgo = new Date("2025-01-15T11:55:00Z").toISOString();
      const status = makeStatus({ createdOn: fiveMinAgo });
      expect(action.resolveState(status, NOW)).toBe("recent");
    });

    it('should return "recent" at exactly 1 second before the 10-minute threshold', () => {
      // 9 min 59 sec ago
      const justUnder = new Date(NOW - 9 * 60 * 1000 - 59 * 1000).toISOString();
      const status = makeStatus({ createdOn: justUnder });
      expect(action.resolveState(status, NOW)).toBe("recent");
    });

    it('should return "live" at exactly the 10-minute boundary', () => {
      const exactlyTenMin = new Date(NOW - 10 * 60 * 1000).toISOString();
      const status = makeStatus({ createdOn: exactlyTenMin });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it('should return "live" for a deployment older than 10 minutes', () => {
      const twoHoursAgo = new Date("2025-01-15T10:00:00Z").toISOString();
      const status = makeStatus({ createdOn: twoHoursAgo });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it('should prioritize "gradual" over "recent"', () => {
      const fiveMinAgo = new Date("2025-01-15T11:55:00Z").toISOString();
      const status = makeStatus({
        isGradual: true,
        isLive: false,
        createdOn: fiveMinAgo,
        versionSplit: "70/30",
      });
      expect(action.resolveState(status, NOW)).toBe("gradual");
    });

    it('should return "live" when createdOn is an invalid date', () => {
      const status = makeStatus({ createdOn: "not-a-date" });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it("should use Date.now() when now parameter is not provided", () => {
      // Use a date far in the past so it's always > 10 minutes
      const oldDate = "2020-01-01T00:00:00Z";
      const status = makeStatus({ createdOn: oldDate });
      expect(action.resolveState(status)).toBe("live");
    });
  });

  // ── formatTitle ──────────────────────────────────────────────────────────

  describe("formatTitle", () => {
    function makeStatus(overrides?: Partial<DeploymentStatus>): DeploymentStatus {
      return {
        isLive: true,
        isGradual: false,
        createdOn: "2025-01-15T10:00:00Z",
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
        ...overrides,
      };
    }

    it('should display "⚫\\nSetup" for unconfigured state', () => {
      const title = action.formatTitle("unconfigured");
      expect(title).toBe("⚫\nSetup");
    });

    it('should display "⚫\\nSetup" for unconfigured state even with a worker name', () => {
      const title = action.formatTitle("unconfigured", "my-worker");
      expect(title).toBe("⚫\nSetup");
    });

    it("should display error state with worker name", () => {
      const title = action.formatTitle("error", "my-worker");
      expect(title).toBe("my-worke\n🔴 ERR");
    });

    it("should display custom error message", () => {
      const title = action.formatTitle("error", "my-worker", "No deploys");
      expect(title).toBe("my-worke\n🔴 No deploys");
    });

    it("should display error with empty worker name", () => {
      const title = action.formatTitle("error", "", "Timeout");
      expect(title).toBe("\n🔴 Timeout");
    });

    it("should display live state with time ago and source", () => {
      const status = makeStatus({ source: "wrangler" });
      const title = action.formatTitle("live", "my-api", undefined, status);
      expect(title).toContain("my-api");
      expect(title).toContain("🟢");
      expect(title).toContain("wrangler");
    });

    it("should display recent state with blue indicator", () => {
      const status = makeStatus({ source: "dashboard" });
      const title = action.formatTitle("recent", "my-api", undefined, status);
      expect(title).toContain("my-api");
      expect(title).toContain("🔵");
      expect(title).toContain("dashboard");
    });

    it("should display gradual state with version split", () => {
      const status = makeStatus({
        isGradual: true,
        versionSplit: "60/40",
      });
      const title = action.formatTitle("gradual", "my-api", undefined, status);
      expect(title).toContain("my-api");
      expect(title).toContain("🟡");
      expect(title).toContain("60/40");
    });

    it("should truncate long worker names in title", () => {
      const status = makeStatus();
      const title = action.formatTitle("live", "my-super-long-worker-name", undefined, status);
      // Name should be truncated to 8 chars
      expect(title.split("\n")[0]).toBe("my-super");
    });

    it("should handle live state without status object", () => {
      const title = action.formatTitle("live", "worker");
      expect(title).toContain("worker");
      expect(title).toContain("🟢");
    });

    it("should handle gradual state without status object", () => {
      const title = action.formatTitle("gradual", "worker");
      expect(title).toContain("worker");
      expect(title).toContain("🟡");
    });

    it("should handle recent state without status object", () => {
      const title = action.formatTitle("recent", "worker");
      expect(title).toContain("worker");
      expect(title).toContain("🔵");
    });

    it('should return "? N/A" for unknown state', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const title = action.formatTitle("unknown" as any, "worker");
      expect(title).toContain("? N/A");
    });

    it("should handle empty worker name for all states", () => {
      expect(action.formatTitle("live", "")).toContain("🟢");
      expect(action.formatTitle("gradual", "")).toContain("🟡");
      expect(action.formatTitle("recent", "")).toContain("🔵");
      expect(action.formatTitle("error", "")).toContain("🔴");
    });
  });

  // ── Lifecycle Methods ────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should show unconfigured when apiToken is missing", async () => {
      const ev = makeMockEvent({ accountId: "acc", workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("⚫\nSetup");
    });

    it("should show unconfigured when accountId is missing", async () => {
      const ev = makeMockEvent({ apiToken: "tok", workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("⚫\nSetup");
    });

    it("should show unconfigured when workerName is missing", async () => {
      const ev = makeMockEvent({ apiToken: "tok", accountId: "acc" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("⚫\nSetup");
    });

    it("should show unconfigured when all settings are empty", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("⚫\nSetup");
    });

    it("should fetch status and update title when settings are complete", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: "2020-01-01T00:00:00Z",
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("my-api");
      expect(ev.action.setTitle).toHaveBeenCalled();
      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🟢");

      vi.useRealTimers();
    });

    it("should show error title when API call throws", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("API down"));

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
      });

      await action.onWillAppear(ev);

      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🔴");

      vi.useRealTimers();
    });

    it("should show error when getDeploymentStatus returns null", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockResolvedValue(null);

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
      });

      await action.onWillAppear(ev);

      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("No deploys");

      vi.useRealTimers();
    });
  });

  describe("onWillDisappear", () => {
    it("should not throw when called without a prior onWillAppear", () => {
      const ev = makeMockEvent();
      expect(() => action.onWillDisappear(ev)).not.toThrow();
    });
  });

  describe("onKeyDown", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should show unconfigured when settings are incomplete", async () => {
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("⚫\nSetup");
    });

    it("should refresh status on key press with valid settings", async () => {
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: "2020-01-01T00:00:00Z",
        source: "api",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "worker",
      });

      await action.onKeyDown(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("worker");
      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🟢");
    });

    it("should show error on key press when API fails", async () => {
      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("timeout"));

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "worker",
      });

      await action.onKeyDown(ev);

      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🔴");
    });
  });
});
