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
import type {
  ZoneAnalyticsMetrics,
  ZoneAnalyticsMetricType,
} from "../../src/types/cloudflare-zone-analytics";
import { ZONE_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-zone-analytics";

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ZoneAnalytics", () => {
  // ── truncateZoneName ─────────────────────────────────────────────────

  describe("truncateZoneName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateZoneName("example.co")).toBe("example.co");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateZoneName("mywebsite.example.com")).toBe("mywebsite…");
    });

    it("should handle empty string", () => {
      expect(truncateZoneName("")).toBe("");
    });
  });

  // ── metricColor ──────────────────────────────────────────────────────

  describe("metricColor", () => {
    it("should return blue for requests", () => {
      expect(metricColor("requests")).toBe(STATUS_COLORS.blue);
    });

    it("should return blue for bandwidth", () => {
      expect(metricColor("bandwidth")).toBe(STATUS_COLORS.blue);
    });

    it("should return green for cache_rate", () => {
      expect(metricColor("cache_rate")).toBe(STATUS_COLORS.green);
    });

    it("should return red for threats", () => {
      expect(metricColor("threats")).toBe(STATUS_COLORS.red);
    });

    it("should return amber for visitors", () => {
      expect(metricColor("visitors")).toBe(STATUS_COLORS.amber);
    });

    it("should return gray for unknown metric", () => {
      expect(metricColor("unknown" as ZoneAnalyticsMetricType)).toBe(STATUS_COLORS.gray);
    });
  });

  // ── formatMetricValue ────────────────────────────────────────────────

  describe("formatMetricValue", () => {
    const metrics = makeMetrics();

    it("should format requests as compact number", () => {
      expect(formatMetricValue("requests", metrics)).toBe("50K");
    });

    it("should format bandwidth as bytes", () => {
      // 10485760 = 10 MB
      expect(formatMetricValue("bandwidth", metrics)).toBe("10MB");
    });

    it("should format cache_rate as percentage", () => {
      // 5242880 / 10485760 = 50%
      expect(formatMetricValue("cache_rate", metrics)).toBe("50%");
    });

    it("should format cache_rate as 0% when no bandwidth", () => {
      expect(formatMetricValue("cache_rate", makeMetrics({ bandwidth: 0 }))).toBe("0%");
    });

    it("should format threats as compact number", () => {
      expect(formatMetricValue("threats", metrics)).toBe("15");
    });

    it("should format visitors as compact number", () => {
      expect(formatMetricValue("visitors", metrics)).toBe("1.2K");
    });

    it("should return N/A for unknown metric", () => {
      expect(formatMetricValue("unknown" as ZoneAnalyticsMetricType, metrics)).toBe("N/A");
    });

    it("should format zero values correctly", () => {
      const zeros = makeMetrics({
        requests: 0,
        bandwidth: 0,
        cachedBytes: 0,
        threats: 0,
        visitors: 0,
      });
      expect(formatMetricValue("requests", zeros)).toBe("0");
      expect(formatMetricValue("bandwidth", zeros)).toBe("0B");
      expect(formatMetricValue("cache_rate", zeros)).toBe("0%");
      expect(formatMetricValue("threats", zeros)).toBe("0");
      expect(formatMetricValue("visitors", zeros)).toBe("0");
    });
  });

  // ── renderMetric ─────────────────────────────────────────────────────

  describe("renderMetric", () => {
    let action: ZoneAnalytics;

    beforeEach(() => {
      action = new ZoneAnalytics();
    });

    it("should return a data URI", () => {
      const result = action.renderMetric("requests", "myzone", makeMetrics(), "24h");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include zone name in SVG", () => {
      const svg = decodeSvg(action.renderMetric("requests", "myzone", makeMetrics(), "24h"));
      expect(svg).toContain("myzone");
    });

    it("should include formatted metric value", () => {
      const svg = decodeSvg(action.renderMetric("requests", "z", makeMetrics(), "24h"));
      expect(svg).toContain("50K");
    });

    it("should include metric label and time range", () => {
      const svg = decodeSvg(action.renderMetric("threats", "z", makeMetrics(), "7d"));
      expect(svg).toContain("threats 7d");
    });

    it("should use correct color for threats", () => {
      const svg = decodeSvg(action.renderMetric("threats", "z", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderMetric("requests", "longzonename", makeMetrics(), "24h", "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longzonename");
    });

    it("should use zoneName for display instead of raw zone ID", () => {
      const svg = decodeSvg(
        action.renderMetric("requests", "mysite.co", makeMetrics(), "24h")
      );
      expect(svg).toContain("mysite.co");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: ZoneAnalytics;

    beforeEach(() => {
      action = new ZoneAnalytics();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings({ zoneId: "z1" }, { apiToken: "t" })
      ).toBe(true);
    });

    it("should return false when zoneId is missing", () => {
      expect(action.hasRequiredSettings({}, { apiToken: "t" })).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(action.hasRequiredSettings({ zoneId: "z1" }, {})).toBe(false);
    });
  });

  // ── hasCredentials ───────────────────────────────────────────────────

  describe("hasCredentials", () => {
    let action: ZoneAnalytics;

    beforeEach(() => {
      action = new ZoneAnalytics();
    });

    it("should return true when apiToken present", () => {
      expect(action.hasCredentials({ apiToken: "t" })).toBe(true);
    });

    it("should return false when apiToken is missing", () => {
      expect(action.hasCredentials({})).toBe(false);
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

      const action = new ZoneAnalytics();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but zoneId missing", async () => {
      vi.useFakeTimers();

      const action = new ZoneAnalytics();
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
      const action = new ZoneAnalytics();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── Key Cycling ──────────────────────────────────────────────────────

  describe("key cycling", () => {
    it("requests → bandwidth", () => {
      const idx = ZONE_METRIC_CYCLE_ORDER.indexOf("requests");
      const next = ZONE_METRIC_CYCLE_ORDER[(idx + 1) % ZONE_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("bandwidth");
    });

    it("bandwidth → cache_rate", () => {
      const idx = ZONE_METRIC_CYCLE_ORDER.indexOf("bandwidth");
      const next = ZONE_METRIC_CYCLE_ORDER[(idx + 1) % ZONE_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("cache_rate");
    });

    it("cache_rate → threats", () => {
      const idx = ZONE_METRIC_CYCLE_ORDER.indexOf("cache_rate");
      const next = ZONE_METRIC_CYCLE_ORDER[(idx + 1) % ZONE_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("threats");
    });

    it("threats → visitors", () => {
      const idx = ZONE_METRIC_CYCLE_ORDER.indexOf("threats");
      const next = ZONE_METRIC_CYCLE_ORDER[(idx + 1) % ZONE_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("visitors");
    });

    it("visitors → requests (wraps)", () => {
      const idx = ZONE_METRIC_CYCLE_ORDER.indexOf("visitors");
      const next = ZONE_METRIC_CYCLE_ORDER[(idx + 1) % ZONE_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("requests");
    });

    it("cycle order should have 5 metrics", () => {
      expect(ZONE_METRIC_CYCLE_ORDER).toHaveLength(5);
    });
  });
});
