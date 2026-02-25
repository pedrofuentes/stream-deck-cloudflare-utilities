/**
 * Tests for the D1 Database Metric action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  D1DatabaseMetric,
  truncateDbName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/d1-database-metric";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type { D1Metrics, D1MetricType } from "../../src/types/cloudflare-d1";
import { D1_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-d1";

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

vi.mock("../../src/services/cloudflare-d1-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-d1-api")>();
  return {
    ...orig,
    CloudflareD1Api: class MockCloudflareD1Api {
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

function makeMetrics(overrides?: Partial<D1Metrics>): D1Metrics {
  return {
    readQueries: 5000,
    writeQueries: 200,
    rowsRead: 15000,
    rowsWritten: 600,
    databaseSizeBytes: 2048000,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = {
  databaseId: "db-123",
  databaseName: "my-db",
  metric: "reads" as const,
  timeRange: "24h" as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateDbName", () => {
  it("should return names ≤ 10 chars unchanged", () => {
    expect(truncateDbName("my-db")).toBe("my-db");
  });

  it("should return exactly 10 chars unchanged", () => {
    expect(truncateDbName("0123456789")).toBe("0123456789");
  });

  it("should truncate and add ellipsis for names > 10 chars", () => {
    expect(truncateDbName("my-production-db")).toBe("my-produc…");
  });

  it("should handle empty string", () => {
    expect(truncateDbName("")).toBe("");
  });
});

describe("metricColor", () => {
  it("should return blue for reads", () => { expect(metricColor("reads")).toBe(STATUS_COLORS.blue); });
  it("should return amber for writes", () => { expect(metricColor("writes")).toBe(STATUS_COLORS.amber); });
  it("should return blue for rows_read", () => { expect(metricColor("rows_read")).toBe(STATUS_COLORS.blue); });
  it("should return amber for rows_written", () => { expect(metricColor("rows_written")).toBe(STATUS_COLORS.amber); });
  it("should return green for db_size", () => { expect(metricColor("db_size")).toBe(STATUS_COLORS.green); });
  it("should return gray for unknown metric", () => { expect(metricColor("unknown" as D1MetricType)).toBe(STATUS_COLORS.gray); });
});

describe("formatMetricValue", () => {
  const metrics = makeMetrics();

  it("should format reads as compact number", () => { expect(formatMetricValue("reads", metrics)).toBe("5K"); });
  it("should format writes as compact number", () => { expect(formatMetricValue("writes", metrics)).toBe("200"); });
  it("should format rows_read as compact number", () => { expect(formatMetricValue("rows_read", metrics)).toBe("15K"); });
  it("should format rows_written as compact number", () => { expect(formatMetricValue("rows_written", metrics)).toBe("600"); });
  it("should format db_size as bytes", () => { expect(formatMetricValue("db_size", metrics)).toMatch(/MB/); });
  it("should return N/A for unknown metric", () => { expect(formatMetricValue("unknown" as D1MetricType, metrics)).toBe("N/A"); });

  it("should format zero values correctly", () => {
    const zeros = makeMetrics({ readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0, databaseSizeBytes: 0 });
    expect(formatMetricValue("reads", zeros)).toBe("0");
    expect(formatMetricValue("writes", zeros)).toBe("0");
    expect(formatMetricValue("db_size", zeros)).toBe("0B");
  });
});

describe("key cycling order", () => {
  it("reads → writes", () => { expect(D1_METRIC_CYCLE_ORDER[(D1_METRIC_CYCLE_ORDER.indexOf("reads") + 1) % D1_METRIC_CYCLE_ORDER.length]).toBe("writes"); });
  it("writes → rows_read", () => { expect(D1_METRIC_CYCLE_ORDER[(D1_METRIC_CYCLE_ORDER.indexOf("writes") + 1) % D1_METRIC_CYCLE_ORDER.length]).toBe("rows_read"); });
  it("rows_read → rows_written", () => { expect(D1_METRIC_CYCLE_ORDER[(D1_METRIC_CYCLE_ORDER.indexOf("rows_read") + 1) % D1_METRIC_CYCLE_ORDER.length]).toBe("rows_written"); });
  it("rows_written → db_size", () => { expect(D1_METRIC_CYCLE_ORDER[(D1_METRIC_CYCLE_ORDER.indexOf("rows_written") + 1) % D1_METRIC_CYCLE_ORDER.length]).toBe("db_size"); });
  it("db_size → reads (wraps)", () => { expect(D1_METRIC_CYCLE_ORDER[(D1_METRIC_CYCLE_ORDER.indexOf("db_size") + 1) % D1_METRIC_CYCLE_ORDER.length]).toBe("reads"); });
  it("should have 5 metrics", () => { expect(D1_METRIC_CYCLE_ORDER).toHaveLength(5); });
});

describe("D1DatabaseMetric", () => {
  let action: D1DatabaseMetric;

  beforeEach(() => {
    action = new D1DatabaseMetric();
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

  // ── hasRequiredSettings ────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    it("should return true with all required settings", () => { expect(action.hasRequiredSettings({ databaseId: "db-1" }, { apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without databaseId", () => { expect(action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ databaseId: "db-1" }, { accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasRequiredSettings({ databaseId: "db-1" }, { apiToken: "t" })).toBe(false); });
  });

  // ── renderMetric ──────────────────────────────────────────────────

  describe("renderMetric", () => {
    it("should render reads with time range", () => {
      const svg = decodeSvg(action.renderMetric("reads", "my-db", makeMetrics(), "24h"));
      expect(svg).toContain("my-db");
      expect(svg).toContain("5K");
      expect(svg).toContain("reads 24h");
      expect(svg).toContain(STATUS_COLORS.blue);
    });

    it("should render db_size without time range suffix", () => {
      const svg = decodeSvg(action.renderMetric("db_size", "my-db", makeMetrics(), "24h"));
      expect(svg).toContain("size");
      expect(svg).not.toContain("size 24h");
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderMetric("reads", "longdbname", makeMetrics(), "24h", "short"));
      expect(svg).toContain("short");
    });

    it("should use correct color for writes", () => {
      const svg = decodeSvg(action.renderMetric("writes", "d", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.amber);
    });

    it("should default to 24h when timeRange is undefined", () => {
      const svg = decodeSvg(action.renderMetric("reads", "d", makeMetrics()));
      expect(svg).toContain("reads 24h");
    });
  });

  // ── Coordinator polling ───────────────────────────────────────────

  describe("coordinator polling", () => {
    it("should subscribe on appear", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(getPollingCoordinator().subscriberCount).toBeGreaterThanOrEqual(1);
    });

    it("should set error state and skipUntil after error", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("API error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect((action as any).isErrorState).toBe(true);
      expect((action as any).skipUntil).toBeGreaterThan(Date.now() - 1000);
    });

    it("should reset error state after successful fetch", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect((action as any).isErrorState).toBe(true);

      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      (action as any).skipUntil = 0;
      await getPollingCoordinator().tick();
      expect((action as any).isErrorState).toBe(false);
      expect((action as any).skipUntil).toBe(0);
    });
  });

  // ── onWillAppear ──────────────────────────────────────────────────

  describe("onWillAppear", () => {
    it("should show setup image when credentials are missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
    });

    it("should show placeholder when databaseId is missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should fetch and display metrics", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect(mockGetAnalytics).toHaveBeenCalledWith("db-123", "24h");
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("5K");
    });

    it("should show ERR when API call fails", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Network error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("ERR");
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should default metric to reads when not set", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({ databaseId: "db-1" });
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("reads 24h");
    });

    it("should schedule refresh via coordinator", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  // ── onDidReceiveSettings ──────────────────────────────────────────

  describe("onDidReceiveSettings", () => {
    it("should show setup image when credentials become missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
    });

    it("should show placeholder when databaseId becomes missing", async () => {
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should reuse cached metrics when only metric changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);

      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "writes" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev2.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("200");
    });

    it("should refetch when databaseId changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);

      const ev2 = makeMockEvent({ ...VALID_SETTINGS, databaseId: "other-db" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
      expect(mockGetAnalytics).toHaveBeenCalledWith("other-db", "24h");
    });

    it("should refetch when timeRange changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);

      const ev2 = makeMockEvent({ ...VALID_SETTINGS, timeRange: "7d" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  // ── onWillDisappear ───────────────────────────────────────────────

  describe("onWillDisappear", () => {
    it("should clean up without error", () => {
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });

    it("should stop polling", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);

      action.onWillDisappear(ev);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    });
  });

  // ── onKeyDown ─────────────────────────────────────────────────────

  describe("onKeyDown", () => {
    it("should cycle from reads to writes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(expect.objectContaining({ metric: "writes" }));
    });

    it("should use cached data (no extra API call)", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);

      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    });

    it("should render the new metric value", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      const svg = decodeSvg(keyEv.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("200"); // writes = 200
    });

    it("should do nothing when settings are incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(ev.action.setSettings).not.toHaveBeenCalled();
    });

    it("should set pendingKeyCycle flag", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));

      // onDidReceiveSettings should skip re-render
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "writes" });
      await action.onDidReceiveSettings(settingsEv);
      expect(settingsEv.action.setImage).not.toHaveBeenCalled();
    });
  });

  // ── Error back-off ────────────────────────────────────────────────

  describe("error back-off", () => {
    it("should keep cached display when refresh fails", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics({ readQueries: 42 }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      mockGetAnalytics.mockRejectedValueOnce(new Error("Rate limited"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should show ERR only when no cached data", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("ERR");
    });

    it("should not render stale data after settings change during fetch", async () => {
      let resolveSlowFetch!: (v: D1Metrics) => void;
      mockGetAnalytics.mockReturnValueOnce(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);
      ev1.action.setImage.mockClear();

      const slowPromise = new Promise<D1Metrics>((r) => { resolveSlowFetch = r; });
      mockGetAnalytics.mockReturnValueOnce(slowPromise);
      vi.advanceTimersByTime(60_000);

      mockGetAnalytics.mockResolvedValueOnce(makeMetrics({ readQueries: 9999 }));
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, databaseId: "new-db" });
      await action.onDidReceiveSettings(ev2);
      ev2.action.setImage.mockClear();

      resolveSlowFetch(makeMetrics({ readQueries: 1 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(ev1.action.setImage).not.toHaveBeenCalled();
    });
  });

  // ── Marquee ───────────────────────────────────────────────────────

  describe("marquee", () => {
    const LONG_NAME = "production-db";
    const LONG_SETTINGS = { ...VALID_SETTINGS, databaseName: LONG_NAME };

    it("should show first 10 chars initially", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("production");
    });

    it("should scroll after marquee ticks", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      await vi.advanceTimersByTimeAsync(2000);
      const calls = ev.action.setImage.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it("should not start marquee for short names", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      await vi.advanceTimersByTimeAsync(3000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop marquee on disappear", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      action.onWillDisappear(ev);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should reset marquee when database changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      await vi.advanceTimersByTimeAsync(2500);

      const ev2 = makeMockEvent({ ...VALID_SETTINGS, databaseId: "new-db", databaseName: "another-long-db" });
      await action.onDidReceiveSettings(ev2);
      const calls = ev2.action.setImage.mock.calls;
      const lastSvg = decodeSvg(calls[calls.length - 1][0]);
      expect(lastSvg).toContain("another-lo");
    });
  });

  // ── Global settings change ────────────────────────────────────────

  describe("global settings change", () => {
    it("should re-initialize when credentials change", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      expect(capturedGlobalListener).not.toBeNull();
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics({ readQueries: 999 }));
      await capturedGlobalListener!({ apiToken: "new-token", accountId: "new-account" });

      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show setup image when credentials are removed", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      vi.mocked(getGlobalSettings).mockReturnValue({});
      await capturedGlobalListener!({});
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
    });
  });
});
