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
import type { R2Metrics, R2MetricType } from "../../src/types/cloudflare-r2";
import { R2_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-r2";

// Mock @elgato/streamdeck
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { error: vi.fn(), debug: vi.fn(), setLevel: vi.fn() },
    actions: { registerAction: vi.fn() },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

// Mock the global settings store
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(() => ({
    apiToken: "mock-token",
    accountId: "mock-account-id",
  })),
  onGlobalSettingsChanged: vi.fn(() => vi.fn()),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEvent(
  settings: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(undefined),
      ...overrides,
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("R2StorageMetric", () => {
  // ── truncateBucketName ───────────────────────────────────────────────

  describe("truncateBucketName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateBucketName("my-bucket")).toBe("my-bucket");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateBucketName("my-very-long-bucket")).toBe("my-very-l…");
    });

    it("should handle empty string", () => {
      expect(truncateBucketName("")).toBe("");
    });
  });

  // ── metricColor ──────────────────────────────────────────────────────

  describe("metricColor", () => {
    it("should return blue for objects", () => {
      expect(metricColor("objects")).toBe(STATUS_COLORS.blue);
    });

    it("should return green for storage", () => {
      expect(metricColor("storage")).toBe(STATUS_COLORS.green);
    });

    it("should return amber for class_a_ops", () => {
      expect(metricColor("class_a_ops")).toBe(STATUS_COLORS.amber);
    });

    it("should return blue for class_b_ops", () => {
      expect(metricColor("class_b_ops")).toBe(STATUS_COLORS.blue);
    });

    it("should return gray for unknown metric", () => {
      expect(metricColor("unknown" as R2MetricType)).toBe(STATUS_COLORS.gray);
    });
  });

  // ── formatMetricValue ────────────────────────────────────────────────

  describe("formatMetricValue", () => {
    const metrics = makeMetrics();

    it("should format objects as compact number", () => {
      expect(formatMetricValue("objects", metrics)).toBe("5K");
    });

    it("should format storage as bytes", () => {
      expect(formatMetricValue("storage", metrics)).toBe("10MB");
    });

    it("should format class_a_ops as compact number", () => {
      expect(formatMetricValue("class_a_ops", metrics)).toBe("300");
    });

    it("should format class_b_ops as compact number", () => {
      expect(formatMetricValue("class_b_ops", metrics)).toBe("8K");
    });

    it("should return N/A for unknown metric", () => {
      expect(formatMetricValue("unknown" as R2MetricType, metrics)).toBe("N/A");
    });

    it("should format zero values correctly", () => {
      const zeros = makeMetrics({
        objectCount: 0,
        payloadSize: 0,
        classAOps: 0,
        classBOps: 0,
      });
      expect(formatMetricValue("objects", zeros)).toBe("0");
      expect(formatMetricValue("storage", zeros)).toBe("0B");
      expect(formatMetricValue("class_a_ops", zeros)).toBe("0");
      expect(formatMetricValue("class_b_ops", zeros)).toBe("0");
    });
  });

  // ── renderMetric ─────────────────────────────────────────────────────

  describe("renderMetric", () => {
    let action: R2StorageMetric;

    beforeEach(() => {
      action = new R2StorageMetric();
    });

    it("should return a data URI", () => {
      const result = action.renderMetric("objects", "my-bucket", makeMetrics(), "24h");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include bucket name in SVG", () => {
      const svg = decodeSvg(action.renderMetric("objects", "my-bucket", makeMetrics(), "24h"));
      expect(svg).toContain("my-bucket");
    });

    it("should include formatted metric value", () => {
      const svg = decodeSvg(action.renderMetric("objects", "b", makeMetrics(), "24h"));
      expect(svg).toContain("5K");
    });

    it("should include metric label and time range", () => {
      const svg = decodeSvg(action.renderMetric("class_a_ops", "b", makeMetrics(), "7d"));
      expect(svg).toContain("A ops 7d");
    });

    it("should use correct color for storage", () => {
      const svg = decodeSvg(action.renderMetric("storage", "b", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderMetric("objects", "longbucketname", makeMetrics(), "24h", "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longbucketname");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: R2StorageMetric;

    beforeEach(() => {
      action = new R2StorageMetric();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { bucketName: "my-bucket" },
          { apiToken: "t", accountId: "a" }
        )
      ).toBe(true);
    });

    it("should return false when bucketName is missing", () => {
      expect(
        action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings({ bucketName: "b" }, { accountId: "a" })
      ).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(
        action.hasRequiredSettings({ bucketName: "b" }, { apiToken: "t" })
      ).toBe(false);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should show setup image when credentials missing", async () => {
      vi.useFakeTimers();
      const { getGlobalSettings } = await import(
        "../../src/services/global-settings-store"
      );
      (getGlobalSettings as any).mockReturnValueOnce({});

      const action = new R2StorageMetric();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but bucket missing", async () => {
      vi.useFakeTimers();

      const action = new R2StorageMetric();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
      vi.useRealTimers();
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up without error", () => {
      const action = new R2StorageMetric();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── Key Cycling ──────────────────────────────────────────────────────

  describe("key cycling", () => {
    it("objects → storage", () => {
      const idx = R2_METRIC_CYCLE_ORDER.indexOf("objects");
      const next = R2_METRIC_CYCLE_ORDER[(idx + 1) % R2_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("storage");
    });

    it("storage → class_a_ops", () => {
      const idx = R2_METRIC_CYCLE_ORDER.indexOf("storage");
      const next = R2_METRIC_CYCLE_ORDER[(idx + 1) % R2_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("class_a_ops");
    });

    it("class_a_ops → class_b_ops", () => {
      const idx = R2_METRIC_CYCLE_ORDER.indexOf("class_a_ops");
      const next = R2_METRIC_CYCLE_ORDER[(idx + 1) % R2_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("class_b_ops");
    });

    it("class_b_ops → objects (wraps)", () => {
      const idx = R2_METRIC_CYCLE_ORDER.indexOf("class_b_ops");
      const next = R2_METRIC_CYCLE_ORDER[(idx + 1) % R2_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("objects");
    });

    it("cycle order should have 4 metrics", () => {
      expect(R2_METRIC_CYCLE_ORDER).toHaveLength(4);
    });
  });
});
