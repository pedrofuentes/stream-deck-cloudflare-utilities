/**
 * Tests for the KV Namespace Metric action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  KvNamespaceMetric,
  truncateNamespaceName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/kv-namespace-metric";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type { KvMetrics, KvMetricType } from "../../src/types/cloudflare-kv";
import { KV_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-kv";

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

vi.mock("../../src/services/cloudflare-kv-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-kv-api")>();
  return {
    ...orig,
    CloudflareKvApi: class MockCloudflareKvApi {
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

function makeMetrics(overrides?: Partial<KvMetrics>): KvMetrics {
  return {
    readQueries: 5000,
    writeQueries: 200,
    deleteQueries: 50,
    listQueries: 100,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = {
  namespaceId: "ns-123",
  namespaceName: "my-kv",
  metric: "reads" as const,
  timeRange: "24h" as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateNamespaceName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateNamespaceName("my-kv")).toBe("my-kv"); });
  it("should truncate names > 10 chars", () => { expect(truncateNamespaceName("my-production-kv")).toBe("my-produc…"); });
  it("should handle empty string", () => { expect(truncateNamespaceName("")).toBe(""); });
});

describe("metricColor", () => {
  it("should return blue for reads", () => { expect(metricColor("reads")).toBe(STATUS_COLORS.blue); });
  it("should return amber for writes", () => { expect(metricColor("writes")).toBe(STATUS_COLORS.amber); });
  it("should return red for deletes", () => { expect(metricColor("deletes")).toBe(STATUS_COLORS.red); });
  it("should return green for lists", () => { expect(metricColor("lists")).toBe(STATUS_COLORS.green); });
  it("should return gray for unknown", () => { expect(metricColor("unknown" as KvMetricType)).toBe(STATUS_COLORS.gray); });
});

describe("formatMetricValue", () => {
  const metrics = makeMetrics();
  it("should format reads", () => { expect(formatMetricValue("reads", metrics)).toBe("5K"); });
  it("should format writes", () => { expect(formatMetricValue("writes", metrics)).toBe("200"); });
  it("should format deletes", () => { expect(formatMetricValue("deletes", metrics)).toBe("50"); });
  it("should format lists", () => { expect(formatMetricValue("lists", metrics)).toBe("100"); });
  it("should return N/A for unknown", () => { expect(formatMetricValue("unknown" as KvMetricType, metrics)).toBe("N/A"); });
  it("should format zero values", () => {
    const zeros = makeMetrics({ readQueries: 0, writeQueries: 0, deleteQueries: 0, listQueries: 0 });
    expect(formatMetricValue("reads", zeros)).toBe("0");
  });
});

describe("key cycling order", () => {
  it("reads → writes", () => { expect(KV_METRIC_CYCLE_ORDER[(KV_METRIC_CYCLE_ORDER.indexOf("reads") + 1) % KV_METRIC_CYCLE_ORDER.length]).toBe("writes"); });
  it("writes → deletes", () => { expect(KV_METRIC_CYCLE_ORDER[(KV_METRIC_CYCLE_ORDER.indexOf("writes") + 1) % KV_METRIC_CYCLE_ORDER.length]).toBe("deletes"); });
  it("deletes → lists", () => { expect(KV_METRIC_CYCLE_ORDER[(KV_METRIC_CYCLE_ORDER.indexOf("deletes") + 1) % KV_METRIC_CYCLE_ORDER.length]).toBe("lists"); });
  it("lists → reads (wraps)", () => { expect(KV_METRIC_CYCLE_ORDER[(KV_METRIC_CYCLE_ORDER.indexOf("lists") + 1) % KV_METRIC_CYCLE_ORDER.length]).toBe("reads"); });
  it("should have 4 metrics", () => { expect(KV_METRIC_CYCLE_ORDER).toHaveLength(4); });
});

describe("KvNamespaceMetric", () => {
  let action: KvNamespaceMetric;

  beforeEach(() => {
    action = new KvNamespaceMetric();
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
    it("should return true with all settings", () => { expect(action.hasRequiredSettings({ namespaceId: "ns-1" }, { apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without namespaceId", () => { expect(action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ namespaceId: "ns-1" }, { accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasRequiredSettings({ namespaceId: "ns-1" }, { apiToken: "t" })).toBe(false); });
  });

  describe("renderMetric", () => {
    it("should render reads with time range", () => {
      const svg = decodeSvg(action.renderMetric("reads", "my-kv", makeMetrics(), "24h"));
      expect(svg).toContain("my-kv");
      expect(svg).toContain("5K");
      expect(svg).toContain("reads 24h");
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderMetric("reads", "longname", makeMetrics(), "24h", "short"));
      expect(svg).toContain("short");
    });

    it("should default to 24h", () => {
      const svg = decodeSvg(action.renderMetric("reads", "d", makeMetrics()));
      expect(svg).toContain("reads 24h");
    });
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

    it("should show placeholder when namespaceId missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display metrics", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetAnalytics).toHaveBeenCalledWith("ns-123", "24h");
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("5K");
    });

    it("should show ERR on API failure", async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error("Net error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });

    it("should default metric to reads", async () => {
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({ namespaceId: "ns-1" });
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("reads 24h");
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
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "writes" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
      expect(decodeSvg(ev2.action.setImage.mock.calls[0][0])).toContain("200");
    });

    it("should refetch when namespaceId changes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ ...VALID_SETTINGS, namespaceId: "ns-other" }));
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
    it("should cycle from reads to writes", async () => {
      mockGetAnalytics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(expect.objectContaining({ metric: "writes" }));
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
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "writes" });
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
    const LONG_SETTINGS = { ...VALID_SETTINGS, namespaceName: "production-kv" };

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
      mockGetAnalytics.mockResolvedValueOnce(makeMetrics({ readQueries: 999 }));
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
