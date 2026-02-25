/**
 * Tests for the Worker Analytics action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorkerAnalytics,
  metricColor,
  formatMetricValue,
} from "../../src/actions/worker-analytics";
import { truncateWorkerName } from "../../src/services/cloudflare-workers-api";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type {
  WorkerAnalyticsMetrics,
  WorkerAnalyticsMetricType,
} from "../../src/types/cloudflare-worker-analytics";
import { WORKER_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-worker-analytics";

// ── Mocks ────────────────────────────────────────────────────────────────────

let capturedGlobalListener: ((settings: Record<string, unknown>) => void) | null = null;
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(),
  onGlobalSettingsChanged: vi.fn().mockImplementation((fn: (settings: Record<string, unknown>) => void) => {
    capturedGlobalListener = fn;
    return vi.fn();
  }),
}));

vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { debug: vi.fn(), error: vi.fn(), setLevel: vi.fn() },
    actions: { registerAction: vi.fn() },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

let mockGetAnalytics: ReturnType<typeof vi.fn>;

vi.mock("../../src/services/cloudflare-worker-analytics-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-worker-analytics-api")>();
  return {
    ...orig,
    CloudflareWorkerAnalyticsApi: class MockCloudflareWorkerAnalyticsApi {
      constructor() { this.getAnalytics = mockGetAnalytics; }
      getAnalytics: ReturnType<typeof vi.fn>;
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(undefined),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makeMetrics(overrides?: Partial<WorkerAnalyticsMetrics>): WorkerAnalyticsMetrics {
  return {
    requests: 5000,
    errors: 23,
    subrequests: 1200,
    wallTime: 150_000,
    cpuTimeP50: 2300,
    cpuTimeP99: 45_000,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = {
  workerName: "my-worker",
  metric: "requests" as const,
  timeRange: "24h" as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateWorkerName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateWorkerName("my-worker")).toBe("my-worker"); });
  it("should return exactly 10 chars unchanged", () => { expect(truncateWorkerName("0123456789")).toBe("0123456789"); });
  it("should truncate names > 10 chars", () => { expect(truncateWorkerName("my-very-long-worker")).toBe("my-very-l…"); });
  it("should handle empty string", () => { expect(truncateWorkerName("")).toBe(""); });
});

describe("metricColor", () => {
  it("should return blue for requests", () => { expect(metricColor("requests")).toBe(STATUS_COLORS.blue); });
  it("should return red for errors", () => { expect(metricColor("errors")).toBe(STATUS_COLORS.red); });
  it("should return red for error_rate", () => { expect(metricColor("error_rate")).toBe(STATUS_COLORS.red); });
  it("should return green for cpu_p50", () => { expect(metricColor("cpu_p50")).toBe(STATUS_COLORS.green); });
  it("should return amber for cpu_p99", () => { expect(metricColor("cpu_p99")).toBe(STATUS_COLORS.amber); });
  it("should return blue for wall_time", () => { expect(metricColor("wall_time")).toBe(STATUS_COLORS.blue); });
  it("should return blue for subrequests", () => { expect(metricColor("subrequests")).toBe(STATUS_COLORS.blue); });
  it("should return gray for unknown", () => { expect(metricColor("unknown" as WorkerAnalyticsMetricType)).toBe(STATUS_COLORS.gray); });
});

describe("formatMetricValue", () => {
  const metrics = makeMetrics();
  it("should format requests", () => { expect(formatMetricValue("requests", metrics)).toBe("5K"); });
  it("should format errors", () => { expect(formatMetricValue("errors", metrics)).toBe("23"); });
  it("should format error_rate as percentage", () => { expect(formatMetricValue("error_rate", metrics)).toBe("0.5%"); });
  it("should format error_rate as 0% when no requests", () => { expect(formatMetricValue("error_rate", makeMetrics({ requests: 0 }))).toBe("0%"); });
  it("should format cpu_p50 as duration", () => { expect(formatMetricValue("cpu_p50", metrics)).toBe("2.3ms"); });
  it("should format cpu_p99 as duration", () => { expect(formatMetricValue("cpu_p99", metrics)).toBe("45ms"); });
  it("should format wall_time as duration", () => { expect(formatMetricValue("wall_time", metrics)).toBe("150ms"); });
  it("should format subrequests", () => { expect(formatMetricValue("subrequests", metrics)).toBe("1.2K"); });
  it("should return N/A for unknown", () => { expect(formatMetricValue("unknown" as WorkerAnalyticsMetricType, metrics)).toBe("N/A"); });
  it("should format zero values", () => {
    const zeros = makeMetrics({ requests: 0, errors: 0, subrequests: 0, wallTime: 0, cpuTimeP50: 0, cpuTimeP99: 0 });
    expect(formatMetricValue("requests", zeros)).toBe("0");
    expect(formatMetricValue("errors", zeros)).toBe("0");
    expect(formatMetricValue("error_rate", zeros)).toBe("0%");
    expect(formatMetricValue("cpu_p50", zeros)).toBe("0ms");
    expect(formatMetricValue("cpu_p99", zeros)).toBe("0ms");
    expect(formatMetricValue("wall_time", zeros)).toBe("0ms");
    expect(formatMetricValue("subrequests", zeros)).toBe("0");
  });
});

describe("key cycling order", () => {
  it("requests → errors", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("requests") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("errors"); });
  it("errors → error_rate", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("errors") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("error_rate"); });
  it("error_rate → cpu_p50", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("error_rate") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("cpu_p50"); });
  it("cpu_p50 → cpu_p99", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("cpu_p50") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("cpu_p99"); });
  it("cpu_p99 → wall_time", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("cpu_p99") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("wall_time"); });
  it("wall_time → subrequests", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("wall_time") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("subrequests"); });
  it("subrequests → requests (wraps)", () => { expect(WORKER_METRIC_CYCLE_ORDER[(WORKER_METRIC_CYCLE_ORDER.indexOf("subrequests") + 1) % WORKER_METRIC_CYCLE_ORDER.length]).toBe("requests"); });
  it("should have 7 metrics", () => { expect(WORKER_METRIC_CYCLE_ORDER).toHaveLength(7); });
});

describe("WorkerAnalytics", () => {
  let action: WorkerAnalytics;

  beforeEach(() => {
    action = new WorkerAnalytics();
    mockGetAnalytics = vi.fn();
    capturedGlobalListener = null;
    vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "test-token", accountId: "test-account" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPollingCoordinator();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("hasRequiredSettings", () => {
    it("should return true with all settings", () => { expect(action.hasRequiredSettings({ workerName: "w" }, { apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without workerName", () => { expect(action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ workerName: "w" }, { accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasRequiredSettings({ workerName: "w" }, { apiToken: "t" })).toBe(false); });
  });

  describe("hasCredentials", () => {
    it("should return true with both", () => { expect(action.hasCredentials({ apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without apiToken", () => { expect(action.hasCredentials({ accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasCredentials({ apiToken: "t" })).toBe(false); });
  });

  describe("renderMetric", () => {
    it("should return a data URI", () => { expect(action.renderMetric("requests", "my-worker", makeMetrics(), "24h")).toMatch(/^data:image\/svg\+xml,/); });
    it("should include worker name", () => { expect(decodeSvg(action.renderMetric("requests", "my-worker", makeMetrics(), "24h"))).toContain("my-worker"); });
    it("should include metric value", () => { expect(decodeSvg(action.renderMetric("requests", "wk", makeMetrics(), "24h"))).toContain("5K"); });
    it("should include label and time range", () => { expect(decodeSvg(action.renderMetric("cpu_p50", "wk", makeMetrics(), "7d"))).toContain("cpu p50 7d"); });
    it("should use correct color", () => { expect(decodeSvg(action.renderMetric("errors", "wk", makeMetrics(), "24h"))).toContain(STATUS_COLORS.red); });
    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderMetric("requests", "longworkername", makeMetrics(), "24h", "short"));
      expect(svg).toContain("short");
      expect(svg).not.toContain("longworkername");
    });
    it("should default to 24h", () => { expect(decodeSvg(action.renderMetric("requests", "w", makeMetrics()))).toContain("reqs 24h"); });
  });

  describe("coordinator polling", () => {
    it("should subscribe on appear", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(getPollingCoordinator().subscriberCount).toBeGreaterThanOrEqual(1);
    });

    it("should set error state after error", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Fail"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect((action as any).isErrorState).toBe(true);
    });

    it("should reset error state after success", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Fail"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      (action as any).skipUntil = 0;
      await getPollingCoordinator().tick();
      expect((action as any).isErrorState).toBe(false);
    });
  });

  describe("onWillAppear", () => {
    it("should show setup image when credentials missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should show placeholder when workerName missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display metrics", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledWith("my-worker", "24h");
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("5K");
    });

    it("should show ERR on API failure", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Net error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });

    it("should default metric to requests", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({ workerName: "w" });
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("reqs 24h");
    });

    it("should schedule refresh via coordinator", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  describe("onDidReceiveSettings", () => {
    it("should show setup when credentials removed", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should reuse cached metrics on metric-only change", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "errors" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
      expect(decodeSvg(ev2.action.setImage.mock.calls[0][0])).toContain("23");
    });

    it("should refetch when workerName changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ ...VALID_SETTINGS, workerName: "other-worker" }));
      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up without error", () => { expect(() => action.onWillDisappear({} as any)).not.toThrow(); });

    it("should stop polling", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      action.onWillDisappear({} as any);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    });
  });

  describe("onKeyDown", () => {
    it("should cycle from requests to errors", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(expect.objectContaining({ metric: "errors" }));
    });

    it("should use cached data", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    });

    it("should do nothing when incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(ev.action.setSettings).not.toHaveBeenCalled();
    });

    it("should set pendingKeyCycle flag", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "errors" });
      await action.onDidReceiveSettings(settingsEv);
      expect(settingsEv.action.setImage).not.toHaveBeenCalled();
    });
  });

  describe("error back-off", () => {
    it("should keep cached display when refresh fails", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetAnalytics.mockRejectedValueOnce(new Error("Rate limited"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should show ERR only when no cache", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });
  });

  describe("marquee", () => {
    const LONG_SETTINGS = { ...VALID_SETTINGS, workerName: "production-worker" };

    it("should scroll for long names", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(2000);
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(0);
    });

    it("should not start for short names", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(3000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop on disappear", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      action.onWillDisappear(ev);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });
  });

  describe("global settings change", () => {
    it("should re-initialize when credentials change", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics({ requests: 999 }));
      await capturedGlobalListener!({ apiToken: "new-token", accountId: "new-account" });
      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show setup when credentials removed", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      vi.mocked(getGlobalSettings).mockReturnValue({});
      await capturedGlobalListener!({});
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });
  });
});
