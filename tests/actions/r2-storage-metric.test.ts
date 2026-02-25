/**
 * Tests for the R2 Storage Metric action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  R2StorageMetric,
  truncateBucketName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/r2-storage-metric";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type { R2Metrics, R2MetricType } from "../../src/types/cloudflare-r2";
import { R2_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-r2";

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

let mockGetMetrics: ReturnType<typeof vi.fn>;

vi.mock("../../src/services/cloudflare-r2-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-r2-api")>();
  return {
    ...orig,
    CloudflareR2Api: class MockCloudflareR2Api {
      constructor() { this.getMetrics = mockGetMetrics; }
      getMetrics: ReturnType<typeof vi.fn>;
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

function makeMetrics(overrides?: Partial<R2Metrics>): R2Metrics {
  return {
    objectCount: 5000,
    payloadSize: 10485760,
    metadataSize: 51200,
    classAOps: 300,
    classBOps: 8000,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = {
  bucketName: "my-bucket",
  metric: "objects" as const,
  timeRange: "24h" as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateBucketName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateBucketName("my-bucket")).toBe("my-bucket"); });
  it("should truncate names > 10 chars", () => { expect(truncateBucketName("my-very-long-bucket")).toBe("my-very-l…"); });
  it("should handle empty string", () => { expect(truncateBucketName("")).toBe(""); });
});

describe("metricColor", () => {
  it("should return blue for objects", () => { expect(metricColor("objects")).toBe(STATUS_COLORS.blue); });
  it("should return green for storage", () => { expect(metricColor("storage")).toBe(STATUS_COLORS.green); });
  it("should return amber for class_a_ops", () => { expect(metricColor("class_a_ops")).toBe(STATUS_COLORS.amber); });
  it("should return blue for class_b_ops", () => { expect(metricColor("class_b_ops")).toBe(STATUS_COLORS.blue); });
  it("should return gray for unknown", () => { expect(metricColor("unknown" as R2MetricType)).toBe(STATUS_COLORS.gray); });
});

describe("formatMetricValue", () => {
  const metrics = makeMetrics();
  it("should format objects", () => { expect(formatMetricValue("objects", metrics)).toBe("5K"); });
  it("should format storage as bytes", () => { expect(formatMetricValue("storage", metrics)).toBe("10MB"); });
  it("should format class_a_ops", () => { expect(formatMetricValue("class_a_ops", metrics)).toBe("300"); });
  it("should format class_b_ops", () => { expect(formatMetricValue("class_b_ops", metrics)).toBe("8K"); });
  it("should return N/A for unknown", () => { expect(formatMetricValue("unknown" as R2MetricType, metrics)).toBe("N/A"); });
  it("should format zero values", () => {
    const zeros = makeMetrics({ objectCount: 0, payloadSize: 0, classAOps: 0, classBOps: 0 });
    expect(formatMetricValue("objects", zeros)).toBe("0");
    expect(formatMetricValue("storage", zeros)).toBe("0B");
    expect(formatMetricValue("class_a_ops", zeros)).toBe("0");
    expect(formatMetricValue("class_b_ops", zeros)).toBe("0");
  });
});

describe("key cycling order", () => {
  it("objects → storage", () => { expect(R2_METRIC_CYCLE_ORDER[(R2_METRIC_CYCLE_ORDER.indexOf("objects") + 1) % R2_METRIC_CYCLE_ORDER.length]).toBe("storage"); });
  it("storage → class_a_ops", () => { expect(R2_METRIC_CYCLE_ORDER[(R2_METRIC_CYCLE_ORDER.indexOf("storage") + 1) % R2_METRIC_CYCLE_ORDER.length]).toBe("class_a_ops"); });
  it("class_a_ops → class_b_ops", () => { expect(R2_METRIC_CYCLE_ORDER[(R2_METRIC_CYCLE_ORDER.indexOf("class_a_ops") + 1) % R2_METRIC_CYCLE_ORDER.length]).toBe("class_b_ops"); });
  it("class_b_ops → objects (wraps)", () => { expect(R2_METRIC_CYCLE_ORDER[(R2_METRIC_CYCLE_ORDER.indexOf("class_b_ops") + 1) % R2_METRIC_CYCLE_ORDER.length]).toBe("objects"); });
  it("should have 4 metrics", () => { expect(R2_METRIC_CYCLE_ORDER).toHaveLength(4); });
});

describe("R2StorageMetric", () => {
  let action: R2StorageMetric;

  beforeEach(() => {
    action = new R2StorageMetric();
    mockGetMetrics = vi.fn();
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
    it("should return true with all settings", () => { expect(action.hasRequiredSettings({ bucketName: "b" }, { apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without bucketName", () => { expect(action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ bucketName: "b" }, { accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasRequiredSettings({ bucketName: "b" }, { apiToken: "t" })).toBe(false); });
  });

  describe("renderMetric", () => {
    it("should return a data URI", () => { expect(action.renderMetric("objects", "my-bucket", makeMetrics(), "24h")).toMatch(/^data:image\/svg\+xml,/); });
    it("should include bucket name", () => { expect(decodeSvg(action.renderMetric("objects", "my-bucket", makeMetrics(), "24h"))).toContain("my-bucket"); });
    it("should include metric value", () => { expect(decodeSvg(action.renderMetric("objects", "b", makeMetrics(), "24h"))).toContain("5K"); });
    it("should include label and time range", () => { expect(decodeSvg(action.renderMetric("class_a_ops", "b", makeMetrics(), "7d"))).toContain("A ops 7d"); });
    it("should use correct color", () => { expect(decodeSvg(action.renderMetric("storage", "b", makeMetrics(), "24h"))).toContain(STATUS_COLORS.green); });
    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderMetric("objects", "longbucketname", makeMetrics(), "24h", "short"));
      expect(svg).toContain("short");
      expect(svg).not.toContain("longbucketname");
    });
    it("should default to 24h", () => { expect(decodeSvg(action.renderMetric("objects", "b", makeMetrics()))).toContain("objects 24h"); });
  });

  describe("coordinator polling", () => {
    it("should subscribe on appear", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(getPollingCoordinator().subscriberCount).toBeGreaterThanOrEqual(1);
    });

    it("should set error state after error", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect((action as any).isErrorState).toBe(true);
    });

    it("should reset error state after success", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
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

    it("should show placeholder when bucketName missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display metrics", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetMetrics).toHaveBeenCalledWith("my-bucket", "24h");
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("5K");
    });

    it("should show ERR on API failure", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Net error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });

    it("should default metric to objects", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({ bucketName: "b" });
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("objects 24h");
    });

    it("should schedule refresh via coordinator", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetMetrics).toHaveBeenCalledTimes(2);
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
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "storage" });
      await action.onDidReceiveSettings(ev2);
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      expect(decodeSvg(ev2.action.setImage.mock.calls[0][0])).toContain("10MB");
    });

    it("should refetch when bucketName changes", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ ...VALID_SETTINGS, bucketName: "other" }));
      expect(mockGetMetrics).toHaveBeenCalledTimes(2);
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up without error", () => { expect(() => action.onWillDisappear({} as any)).not.toThrow(); });

    it("should stop polling", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      action.onWillDisappear({} as any);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe("onKeyDown", () => {
    it("should cycle from objects to storage", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(expect.objectContaining({ metric: "storage" }));
    });

    it("should use cached data", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    });

    it("should do nothing when incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(ev.action.setSettings).not.toHaveBeenCalled();
    });

    it("should set pendingKeyCycle flag", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onKeyDown(makeMockEvent(VALID_SETTINGS));
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "storage" });
      await action.onDidReceiveSettings(settingsEv);
      expect(settingsEv.action.setImage).not.toHaveBeenCalled();
    });
  });

  describe("error back-off", () => {
    it("should keep cached display when refresh fails", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetMetrics.mockRejectedValueOnce(new Error("Rate limited"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should show ERR only when no cache", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[1][0])).toContain("ERR");
    });
  });

  describe("marquee", () => {
    const LONG_SETTINGS = { ...VALID_SETTINGS, bucketName: "production-bucket" };

    it("should scroll for long names", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(2000);
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(0);
    });

    it("should not start for short names", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(3000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop on disappear", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
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
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetMetrics.mockResolvedValueOnce(makeMetrics({ objectCount: 999 }));
      await capturedGlobalListener!({ apiToken: "new-token", accountId: "new-account" });
      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show setup when credentials removed", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      vi.mocked(getGlobalSettings).mockReturnValue({});
      await capturedGlobalListener!({});
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });
  });
});
