import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerDeploymentStatus } from "../../src/actions/worker-deployment-status";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import type { DeploymentStatus } from "../../src/types/cloudflare-workers";
import { getGlobalSettings } from "../../src/services/global-settings-store";

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

// Mock the global settings store
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(),
  onGlobalSettingsChanged: vi.fn().mockReturnValue(vi.fn()),
}));

// Helper to create a mock SD event
function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Decode a data URI to the raw SVG string for assertion convenience. */
function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

describe("WorkerDeploymentStatus", () => {
  let action: WorkerDeploymentStatus;

  beforeEach(() => {
    action = new WorkerDeploymentStatus();
    vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "tok", accountId: "acc" });
  });

  // -- resolveState --

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

    it("should return gradual when deployment is a gradual rollout", () => {
      const status = makeStatus({ isGradual: true, isLive: false, versionSplit: "60/40" });
      expect(action.resolveState(status, NOW)).toBe("gradual");
    });

    it("should return recent when deployment is within 10 minutes", () => {
      const fiveMinAgo = new Date("2025-01-15T11:55:00Z").toISOString();
      const status = makeStatus({ createdOn: fiveMinAgo });
      expect(action.resolveState(status, NOW)).toBe("recent");
    });

    it("should return recent at exactly 1 second before the 10-minute threshold", () => {
      const justUnder = new Date(NOW - 9 * 60 * 1000 - 59 * 1000).toISOString();
      const status = makeStatus({ createdOn: justUnder });
      expect(action.resolveState(status, NOW)).toBe("recent");
    });

    it("should return live at exactly the 10-minute boundary", () => {
      const exactlyTenMin = new Date(NOW - 10 * 60 * 1000).toISOString();
      const status = makeStatus({ createdOn: exactlyTenMin });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it("should return live for a deployment older than 10 minutes", () => {
      const twoHoursAgo = new Date("2025-01-15T10:00:00Z").toISOString();
      const status = makeStatus({ createdOn: twoHoursAgo });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it("should prioritize gradual over recent", () => {
      const fiveMinAgo = new Date("2025-01-15T11:55:00Z").toISOString();
      const status = makeStatus({
        isGradual: true,
        isLive: false,
        createdOn: fiveMinAgo,
        versionSplit: "70/30",
      });
      expect(action.resolveState(status, NOW)).toBe("gradual");
    });

    it("should return live when createdOn is an invalid date", () => {
      const status = makeStatus({ createdOn: "not-a-date" });
      expect(action.resolveState(status, NOW)).toBe("live");
    });

    it("should use Date.now() when now parameter is not provided", () => {
      const oldDate = "2020-01-01T00:00:00Z";
      const status = makeStatus({ createdOn: oldDate });
      expect(action.resolveState(status)).toBe("live");
    });
  });

  // -- renderStatus --

  describe("renderStatus", () => {
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

    it("should return a data URI for error state", () => {
      const result = action.renderStatus("error", "my-worker");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should display red indicator for error state", () => {
      const result = action.renderStatus("error", "my-worker");
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should display ERR text for error state without message", () => {
      const result = action.renderStatus("error", "my-worker");
      const svg = decodeSvg(result);
      expect(svg).toContain("ERR");
    });

    it("should display custom error message", () => {
      const result = action.renderStatus("error", "my-worker", "No deploys");
      const svg = decodeSvg(result);
      expect(svg).toContain("No deploys");
    });

    it("should display worker name in error state", () => {
      const result = action.renderStatus("error", "my-worker");
      const svg = decodeSvg(result);
      expect(svg).toContain("my-worke");
    });

    it("should handle empty worker name in error state", () => {
      const result = action.renderStatus("error", "", "Timeout");
      const svg = decodeSvg(result);
      expect(svg).toContain("Timeout");
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should display green indicator for live state", () => {
      const status = makeStatus({ source: "wrangler" });
      const result = action.renderStatus("live", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should display source for live state", () => {
      const status = makeStatus({ source: "wrangler" });
      const result = action.renderStatus("live", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain("wrangler");
    });

    it("should display worker name for live state", () => {
      const status = makeStatus();
      const result = action.renderStatus("live", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain("my-api");
    });

    it("should display blue indicator for recent state", () => {
      const status = makeStatus({ source: "dashboard" });
      const result = action.renderStatus("recent", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.blue);
    });

    it("should display source for recent state", () => {
      const status = makeStatus({ source: "dashboard" });
      const result = action.renderStatus("recent", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain("dashboard");
    });

    it("should display orange indicator for gradual state", () => {
      const status = makeStatus({ isGradual: true, versionSplit: "60/40" });
      const result = action.renderStatus("gradual", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.orange);
    });

    it("should display version split for gradual state", () => {
      const status = makeStatus({ isGradual: true, versionSplit: "60/40" });
      const result = action.renderStatus("gradual", "my-api", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain("60/40");
    });

    it("should truncate long worker names", () => {
      const status = makeStatus();
      const result = action.renderStatus("live", "my-super-long-worker-name", undefined, status);
      const svg = decodeSvg(result);
      expect(svg).toContain("my-super");
      expect(svg).not.toContain("my-super-long-worker-name");
    });

    it("should handle live state without status object", () => {
      const result = action.renderStatus("live", "worker");
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should handle gradual state without status object", () => {
      const result = action.renderStatus("gradual", "worker");
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.orange);
    });

    it("should handle recent state without status object", () => {
      const result = action.renderStatus("recent", "worker");
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.blue);
    });

    it("should return gray indicator for unknown state", () => {
      const result = action.renderStatus("unknown" as any, "worker");
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.gray);
    });

    it("should handle empty worker name for all states", () => {
      const status = makeStatus();
      expect(decodeSvg(action.renderStatus("live", "", undefined, status))).toContain(STATUS_COLORS.green);
      expect(decodeSvg(action.renderStatus("gradual", "", undefined, status))).toContain(STATUS_COLORS.orange);
      expect(decodeSvg(action.renderStatus("recent", "", undefined, status))).toContain(STATUS_COLORS.blue);
      expect(decodeSvg(action.renderStatus("error", ""))).toContain(STATUS_COLORS.red);
    });

    it("should handle undefined worker name", () => {
      const result = action.renderStatus("error", undefined);
      const svg = decodeSvg(result);
      expect(svg).toContain(STATUS_COLORS.red);
    });
  });

  // -- Lifecycle Methods --

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should show placeholder when apiToken is missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({ accountId: "acc" });
      const ev = makeMockEvent({ workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should show placeholder when accountId is missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "tok" });
      const ev = makeMockEvent({ workerName: "w" });
      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should show placeholder when workerName is missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should show placeholder when all settings are empty", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should fetch status and set image when settings are complete", async () => {
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
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("my-api");
      expect(ev.action.setImage).toHaveBeenCalled();
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.green);

      vi.useRealTimers();
    });

    it("should show error image when API call throws", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("API down"));

      const ev = makeMockEvent({
        workerName: "my-api",
      });

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);

      vi.useRealTimers();
    });

    it("should show error when getDeploymentStatus returns null", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockResolvedValue(null);

      const ev = makeMockEvent({
        workerName: "my-api",
      });

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("No deploys");

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
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should show placeholder when new settings are empty", async () => {
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
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
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onDidReceiveSettings(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("my-api");
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.green);

      vi.useRealTimers();
    });

    it("should show error when API call fails after settings update", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("bad token"));

      const ev = makeMockEvent({
        workerName: "my-api",
      });

      await action.onDidReceiveSettings(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);

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

      const ev1 = makeMockEvent({
        workerName: "worker-a",
        refreshIntervalSeconds: 60,
      });
      await action.onWillAppear(ev1);
      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("worker-a");

      const ev2 = makeMockEvent({
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

      const ev1 = makeMockEvent({
        workerName: "my-api",
      });
      await action.onDidReceiveSettings(ev1);
      expect(mockGetDeploymentStatus).toHaveBeenCalled();

      const ev2 = makeMockEvent({});
      await action.onDidReceiveSettings(ev2);
      const svg = decodeSvg(ev2.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");

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
      expect(ev.action.setImage).not.toHaveBeenCalled();
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
        workerName: "worker",
      });

      await action.onKeyDown(ev);

      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("worker");
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should show error on key press when API fails", async () => {
      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("timeout"));

      const ev = makeMockEvent({
        workerName: "worker",
      });

      await action.onKeyDown(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);
    });
  });

  // -- getPollingInterval --

  describe("getPollingInterval", () => {
    it("should return 10 000 ms for recent state", () => {
      expect(action.getPollingInterval("recent", 60)).toBe(10_000);
    });

    it("should return 10 000 ms for gradual state", () => {
      expect(action.getPollingInterval("gradual", 60)).toBe(10_000);
    });

    it("should return 30 000 ms for error state", () => {
      expect(action.getPollingInterval("error", 60)).toBe(30_000);
    });

    it("should return base interval for live state", () => {
      expect(action.getPollingInterval("live", 60)).toBe(60_000);
    });

    it("should return base interval for null state", () => {
      expect(action.getPollingInterval(null, 120)).toBe(120_000);
    });

    it("should ignore base interval for active states", () => {
      expect(action.getPollingInterval("recent", 3600)).toBe(10_000);
      expect(action.getPollingInterval("gradual", 3600)).toBe(10_000);
    });

    it("should ignore base interval for error state", () => {
      expect(action.getPollingInterval("error", 10)).toBe(30_000);
    });
  });

  // -- Adaptive Polling Behavior --

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
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

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
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(110_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should back off after an error", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("fail"));

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 60,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should transition from fast poll to normal poll when deploy ages out", async () => {
      vi.useFakeTimers();

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
        workerName: "my-api",
        refreshIntervalSeconds: 300,
      });

      await action.onWillAppear(ev);
      const firstSvg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(firstSvg).toContain(STATUS_COLORS.blue);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);

      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      const callCount = mockGetDeploymentStatus.mock.calls.length;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(callCount);

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
        workerName: "my-api",
        refreshIntervalSeconds: 60,
      });

      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      action.onWillDisappear(ev);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  // -- Display Refresh (seconds tick) --

  describe("display refresh", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should tick every second when deployment is seconds-old", async () => {
      vi.useFakeTimers();

      // Deploy 10 seconds ago → shows "10s"
      const tenSecsAgo = new Date(Date.now() - 10_000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: tenSecsAgo,
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      // Initial render from API call
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const firstSvg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(firstSvg).toContain("10s");

      // After 1 second the display should refresh (no API call)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const secondSvg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(secondSvg).toContain("11s");

      // Still only 1 API call — the display refresh is cosmetic
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should stop ticking once display moves past seconds to minutes", async () => {
      vi.useFakeTimers();

      // Deploy 58 seconds ago → shows "58s", will cross into "1m" in 2s
      const fiftyEightSecsAgo = new Date(Date.now() - 58_000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: fiftyEightSecsAgo,
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 300,
      });

      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      // +1s → "59s" (still ticking)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const at59 = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(at59).toContain("59s");

      // +1s → "1m" (transitions to minutes, tick should stop after this render)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(3);
      const at1m = decodeSvg(ev.action.setImage.mock.calls[2][0]);
      expect(at1m).toContain("1m");

      // Record call count — no more display ticks should happen
      const callsAfterStop = ev.action.setImage.mock.calls.length;

      // +5s — should NOT increment (display timer stopped)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(callsAfterStop);

      vi.useRealTimers();
    });

    it("should not start display timer for old deployments (minutes/hours)", async () => {
      vi.useFakeTimers();

      // Deploy 5 minutes ago → shows "5m", no seconds to tick
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: fiveMinAgo,
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      // +3s — no display tick expected
      await vi.advanceTimersByTimeAsync(3_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should not start display timer on error", async () => {
      vi.useFakeTimers();

      mockGetDeploymentStatus = vi.fn().mockRejectedValue(new Error("fail"));

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 60,
      });

      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      // +3s — no display tick on error state
      await vi.advanceTimersByTimeAsync(3_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should stop display timer on disappear", async () => {
      vi.useFakeTimers();

      const fiveSecsAgo = new Date(Date.now() - 5_000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: true,
        isGradual: false,
        createdOn: fiveSecsAgo,
        source: "wrangler",
        versionSplit: "100",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);

      // Confirm ticking
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);

      // Disappear stops the display timer
      action.onWillDisappear(ev);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should tick for gradual deployments showing seconds", async () => {
      vi.useFakeTimers();

      const twentySecsAgo = new Date(Date.now() - 20_000).toISOString();
      mockGetDeploymentStatus = vi.fn().mockResolvedValue({
        isLive: false,
        isGradual: true,
        createdOn: twentySecsAgo,
        source: "wrangler",
        versionSplit: "60/40",
        deploymentId: "dep-1",
      });

      const ev = makeMockEvent({
        workerName: "my-api",
        refreshIntervalSeconds: 120,
      });

      await action.onWillAppear(ev);
      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const firstSvg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(firstSvg).toContain("20s");
      expect(firstSvg).toContain(STATUS_COLORS.orange);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const secondSvg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(secondSvg).toContain("21s");

      vi.useRealTimers();
    });
  });
});
