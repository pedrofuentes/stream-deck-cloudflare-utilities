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

    it("should show placeholder when apiToken is missing", async () => {
      const ev = makeMockEvent({ accountId: "acc", workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
    });

    it("should show placeholder when accountId is missing", async () => {
      const ev = makeMockEvent({ apiToken: "tok", workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
    });

    it("should show placeholder when workerName is missing", async () => {
      const ev = makeMockEvent({ apiToken: "tok", accountId: "acc" });
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
    });

    it("should show placeholder when all settings are empty", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
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

  describe("onDidReceiveSettings", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should show placeholder when new settings are incomplete", async () => {
      const ev = makeMockEvent({ apiToken: "tok" });
      await action.onDidReceiveSettings(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
    });

    it("should show placeholder when new settings are empty", async () => {
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(ev.action.setTitle).toHaveBeenCalledWith("...");
    });

    it("should fetch status when settings become complete", async () => {
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

      await action.onDidReceiveSettings(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("my-api");
      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🟢");

      vi.useRealTimers();
    });

    it("should show error when API call fails after settings update", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("bad token"));

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
      });

      await action.onDidReceiveSettings(ev);

      const titleArg = ev.action.setTitle.mock.calls[0][0] as string;
      expect(titleArg).toContain("🔴");

      vi.useRealTimers();
    });

    it("should restart refresh cycle when settings change", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: "2020-01-01T00:00:00Z",
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      // First appearance with settings
      const ev1 = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "worker-a",
        refreshIntervalSeconds: 60,
      });
      await action.onWillAppear(ev1);
      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("worker-a");

      // Settings change via PI — should restart with new worker name
      const ev2 = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "worker-b",
        refreshIntervalSeconds: 60,
      });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("worker-b");

      vi.useRealTimers();
    });

    it("should handle transition from configured to unconfigured", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: "2020-01-01T00:00:00Z",
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      // First: fully configured
      const ev1 = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
      });
      await action.onDidReceiveSettings(ev1);
      expect(mockGetDeploymentStatus).toHaveBeenCalled();

      // Then: user clears settings
      const ev2 = makeMockEvent({});
      await action.onDidReceiveSettings(ev2);
      expect(ev2.action.setTitle).toHaveBeenCalledWith("...");

      vi.useRealTimers();
    });
  });

  describe("onKeyDown", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should do nothing when settings are incomplete", async () => {
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(ev.action.setTitle).not.toHaveBeenCalled();
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

  // ── getPollingInterval ───────────────────────────────────────────────────

  describe("getPollingInterval", () => {
    it('should return 10 000 ms for "recent" state', () => {
      expect(action.getPollingInterval("recent", 60)).toBe(10_000);
    });

    it('should return 10 000 ms for "gradual" state', () => {
      expect(action.getPollingInterval("gradual", 60)).toBe(10_000);
    });

    it('should return 30 000 ms for "error" state', () => {
      expect(action.getPollingInterval("error", 60)).toBe(30_000);
    });

    it('should return base interval for "live" state', () => {
      expect(action.getPollingInterval("live", 60)).toBe(60_000);
    });

    it("should return base interval for null state", () => {
      expect(action.getPollingInterval(null, 120)).toBe(120_000);
    });

    it("should ignore base interval for active states", () => {
      // Even with a very long base interval, active states use fast poll
      expect(action.getPollingInterval("recent", 3600)).toBe(10_000);
      expect(action.getPollingInterval("gradual", 3600)).toBe(10_000);
    });

    it("should ignore base interval for error state", () => {
      expect(action.getPollingInterval("error", 10)).toBe(30_000);
    });
  });

  // ── Adaptive Polling Behavior ────────────────────────────────────────────

  describe("adaptive polling", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should schedule fast poll after detecting recent deployment", async () => {
      vi.useFakeTimers();

      const recentDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: recentDate,
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
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // Advance by 10s (fast poll interval) — should trigger another fetch
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      // Should NOT have fetched again at 20s if we haven't advanced that far
      // (just verifying the timer resolves at the correct interval)

      vi.useRealTimers();
    });

    it("should schedule normal poll after detecting live deployment", async () => {
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
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // After 10s — should NOT have polled yet (normal interval is 120s)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // After 120s total — should poll
      await vi.advanceTimersByTimeAsync(110_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should back off after an error", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("fail"));

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
        refreshIntervalSeconds: 60,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // After 10s — should NOT have retried (error backoff is 30s)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // After 30s total — should retry
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should transition from fast poll to normal poll when deploy ages out", async () => {
      vi.useFakeTimers();

      // Start with a recent deployment (9 min ago so it ages out after ~1 min)
      const nineMinAgo = new Date(Date.now() - 9 * 60 * 1000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: nineMinAgo,
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        apiToken: "tok",
        accountId: "acc",
        workerName: "my-api",
        refreshIntervalSeconds: 300,
      });

      await action.onWillAppear(ev);
      // First call: state is "recent" → fast poll
      const firstTitle = ev.action.setTitle.mock.calls[0][0] as string;
      expect(firstTitle).toContain("🔵");

      // After 10s the deploy is 9m10s old → still recent, fast poll
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      // After several more fast polls, the deploy ages past 10 min
      // 6 more × 10s = 60s more → deploy is now 10m+ old → "live"
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      // At this point deploy is ~9m + 70s = 10m10s → live state
      // The next poll should now be scheduled at 300s, not 10s
      const callCount = mockGetDeploymentStatus.mock.calls.length;

      // Advance 10s — should NOT poll (we're now on normal schedule)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(callCount);

      // Advance remaining to hit 300s — should poll
      await vi.advanceTimersByTimeAsync(290_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(callCount + 1);

      vi.useRealTimers();
    });

    it("should stop polling after onWillDisappear", async () => {
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
        refreshIntervalSeconds: 60,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      // Disappear — should cancel the timeout
      action.onWillDisappear(ev);

      // Advance past the poll interval — should NOT trigger
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
