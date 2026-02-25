/**
 * Tests for the Zone Analytics action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ZoneAnalytics,
  truncateZoneName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/zone-analytics";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type {
  ZoneAnalyticsMetrics,
  ZoneAnalyticsMetricType,
} from "../../src/types/cloudflare-zone-analytics";
import { ZONE_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-zone-analytics";

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

vi.mock("../../src/services/cloudflare-zone-analytics-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-zone-analytics-api")>();
  return {
    ...orig,
    CloudflareZoneAnalyticsApi: class MockCloudflareZoneAnalyticsApi {
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

function makeMetrics(overrides?: Partial<ZoneAnalyticsMetrics>): ZoneAnalyticsMetrics {
  return {
    requests: 50000,
    bandwidth: 10485760,
    cachedBytes: 5242880,
    threats: 15,
    visitors: 1200,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = {
  zoneId: "zone-123",
  zoneName: "example.co",
  metric: "requests" as const,
  timeRange: "24h" as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateZoneName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateZoneName("example.co")).toBe("example.co"); });
  it("should truncate names > 10 chars", () => { expect(truncateZoneName("mywebsite.example.com")).toBe("mywebsite…"); });
  it("should handle empty string", () => { expect(truncateZoneName("")).toBe(""); });
});

describe("metricColor", () => {
  it("should return blue for requests", () => { expect(metricColor("requests")).toBe(STATUS_COLORS.blue); });
  it("should return blue for bandwidth", () => { expect(metricColor("bandwidth")).toBe(STATUS_COLORS.blue); });
  it("should return green for cache_rate", () => { expect(metricColor("cache_rate")).toBe(STATUS_COLORS.green); });
  it("should return red for threats", () => { expect(metricColor("threats")).toBe(STATUS_COLORS.red); });
  it("should return amber for visitors", () => { expect(metricColor("visitors")).toBe(STATUS_COLORS.amber); });
  it("should return gray for unknown", () => { expect(metricColor("unknown" as ZoneAnalyticsMetricType)).toBe(STATUS_COLORS.gray); });
});

describe("formatMetricValue", () => {
  const metrics = makeMetrics();
  it("should format requests", () => { expect(formatMetricValue("requests", metrics)).toBe("50K"); });
  it("should format bandwidth as bytes", () => { expect(formatMetricValue("bandwidth", metrics)).toBe("10MB"); });
  it("should format cache_rate as percentage", () => { expect(formatMetricValue("cache_rate", metrics)).toBe("50%"); });
  it("should format cache_rate as 0% when no bandwidth", () => { expect(formatMetricValue("cache_rate", makeMetrics({ bandwidth: 0 }))).toBe("0%"); });
  it("should format threats", () => { expect(formatMetricValue("threats", metrics)).toBe("15"); });
  it("should format visitors", () => { expect(formatMetricValue("visitors", metrics)).toBe("1.2K"); });
  it("should return N/A for unknown", () => { expect(formatMetricValue("unknown" as ZoneAnalyticsMetricType, metrics)).toBe("N/A"); });
  it("should format zero values", () => {
    const zeros = makeMetrics({ requests: 0, bandwidth: 0, cachedBytes: 0, threats: 0, visitors: 0 });
    expect(formatMetricValue("requests", zeros)).toBe("0");
    expect(formatMetricValue("bandwidth", zeros)).toBe("0B");
    expect(formatMetricValue("cache_rate", zeros)).toBe("0%");
    expect(formatMetricValue("threats", zeros)).toBe("0");
    expect(formatMetricValue("visitors", zeros)).toBe("0");
  });
});

describe("key cycling order", () => {
  it("requests → bandwidth", () => { expect(ZONE_METRIC_CYCLE_ORDER[(ZONE_METRIC_CYCLE_ORDER.indexOf("requests") + 1) % ZONE_METRIC_CYCLE_ORDER.length]).toBe("bandwidth"); });
  it("bandwidth → cache_rate", () => { expect(ZONE_METRIC_CYCLE_ORDER[(ZONE_METRIC_CYCLE_ORDER.indexOf("bandwidth") + 1) % ZONE_METRIC_CYCLE_ORDER.length]).toBe("cache_rate"); });
  it("cache_rate → threats", () => { expect(ZONE_METRIC_CYCLE_ORDER[(ZONE_METRIC_CYCLE_ORDER.indexOf("cache_rate") + 1) % ZONE_METRIC_CYCLE_ORDER.length]).toBe("threats"); });
  it("threats → visitors", () => { expect(ZONE_METRIC_CYCLE_ORDER[(ZONE_METRIC_CYCLE_ORDER.indexOf("threats") + 1) % ZONE_METRIC_CYCLE_ORDER.length]).toBe("visitors"); });
  it("visitors → requests (wraps)", () => { expect(ZONE_METRIC_CYCLE_ORDER[(ZONE_METRIC_CYCLE_ORDER.indexOf("visitors") + 1) % ZONE_METRIC_CYCLE_ORDER.length]).toBe("requests"); });
  it("should have 5 metrics", () => { expect(ZONE_METRIC_CYCLE_ORDER).toHaveLength(5); });
});

describe("ZoneAnalytics", () => {
  let action: ZoneAnalytics;

  beforeEach(() => {
    action = new ZoneAnalytics();
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
    it("should return true with apiToken and zoneId", () => { expect(action.hasRequiredSettings({ zoneId: "z1" }, { apiToken: "t" })).toBe(true); });
    it("should return false without zoneId", () => { expect(action.hasRequiredSettings({}, { apiToken: "t" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ zoneId: "z1" }, {})).toBe(false); });
  });

  describe("hasCredentials", () => {
    it("should return true with apiToken", () => { expect(action.hasCredentials({ apiToken: "t" })).toBe(true); });
    it("should return false without apiToken", () => { expect(action.hasCredentials({})).toBe(false); });
  });

  describe("renderMetric", () => {
    it("should return a data URI", () => { expect(action.renderMetric("requests", "myzone", makeMetrics(), "24h")).toMatch(/^data:image\/svg\+xml,/); });
    it("should include zone name", () => { expect(decodeSvg(action.renderMetric("requests", "myzone", makeMetrics(), "24h"))).toContain("myzone"); });
    it("should include metric value", () => { expect(decodeSvg(action.renderMetric("requests", "z", makeMetrics(), "24h"))).toContain("50K"); });
    it("should include label and time range", () => { expect(decodeSvg(action.renderMetric("threats", "z", makeMetrics(), "7d"))).toContain("threats 7d"); });
    it("should use correct color", () => { expect(decodeSvg(action.renderMetric("threats", "z", makeMetrics(), "24h"))).toContain(STATUS_COLORS.red); });
    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderMetric("requests", "longzonename", makeMetrics(), "24h", "short"));
      expect(svg).toContain("short");
      expect(svg).not.toContain("longzonename");
    });
    it("should default to 24h", () => { expect(decodeSvg(action.renderMetric("requests", "z", makeMetrics()))).toContain("reqs 24h"); });
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

    it("should show placeholder when zoneId missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display metrics", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledWith("zone-123", "24h");
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("50K");
    });

    it("should show ERR on API failure", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("API error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });

    it("should default metric to requests", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({ zoneId: "z1" });
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
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "bandwidth" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
      expect(decodeSvg(ev2.action.setImage.mock.calls[0][0])).toContain("10MB");
    });

    it("should refetch when zoneId changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ ...VALID_SETTINGS, zoneId: "zone-other" }));
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
    it("should cycle from requests to bandwidth", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(expect.objectContaining({ metric: "bandwidth" }));
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
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "bandwidth" });
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
    const LONG_SETTINGS = { ...VALID_SETTINGS, zoneName: "production.example.com" };

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
      await capturedGlobalListener!({ apiToken: "new-token" });
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
