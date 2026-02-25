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
import type { KvMetrics, KvMetricType } from "../../src/types/cloudflare-kv";
import { KV_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-kv";

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

function makeMetrics(overrides?: Partial<KvMetrics>): KvMetrics {
  return {
    readQueries: 10000,
    writeQueries: 500,
    deleteQueries: 50,
    listQueries: 100,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("KvNamespaceMetric", () => {
  // ── truncateNamespaceName ────────────────────────────────────────────

  describe("truncateNamespaceName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateNamespaceName("my-ns")).toBe("my-ns");
    });

    it("should return exactly 10 chars unchanged", () => {
      expect(truncateNamespaceName("0123456789")).toBe("0123456789");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateNamespaceName("my-production-kv")).toBe("my-produc…");
    });

    it("should handle empty string", () => {
      expect(truncateNamespaceName("")).toBe("");
    });
  });

  // ── metricColor ──────────────────────────────────────────────────────

  describe("metricColor", () => {
    it("should return blue for reads", () => {
      expect(metricColor("reads")).toBe(STATUS_COLORS.blue);
    });

    it("should return amber for writes", () => {
      expect(metricColor("writes")).toBe(STATUS_COLORS.amber);
    });

    it("should return red for deletes", () => {
      expect(metricColor("deletes")).toBe(STATUS_COLORS.red);
    });

    it("should return green for lists", () => {
      expect(metricColor("lists")).toBe(STATUS_COLORS.green);
    });

    it("should return gray for unknown metric", () => {
      expect(metricColor("unknown" as KvMetricType)).toBe(STATUS_COLORS.gray);
    });
  });

  // ── formatMetricValue ────────────────────────────────────────────────

  describe("formatMetricValue", () => {
    const metrics = makeMetrics();

    it("should format reads as compact number", () => {
      expect(formatMetricValue("reads", metrics)).toBe("10K");
    });

    it("should format writes as compact number", () => {
      expect(formatMetricValue("writes", metrics)).toBe("500");
    });

    it("should format deletes as compact number", () => {
      expect(formatMetricValue("deletes", metrics)).toBe("50");
    });

    it("should format lists as compact number", () => {
      expect(formatMetricValue("lists", metrics)).toBe("100");
    });

    it("should return N/A for unknown metric", () => {
      expect(formatMetricValue("unknown" as KvMetricType, metrics)).toBe("N/A");
    });

    it("should format zero values correctly", () => {
      const zeros = makeMetrics({
        readQueries: 0,
        writeQueries: 0,
        deleteQueries: 0,
        listQueries: 0,
      });
      expect(formatMetricValue("reads", zeros)).toBe("0");
      expect(formatMetricValue("writes", zeros)).toBe("0");
      expect(formatMetricValue("deletes", zeros)).toBe("0");
      expect(formatMetricValue("lists", zeros)).toBe("0");
    });
  });

  // ── renderMetric ─────────────────────────────────────────────────────

  describe("renderMetric", () => {
    let action: KvNamespaceMetric;

    beforeEach(() => {
      action = new KvNamespaceMetric();
    });

    it("should return a data URI", () => {
      const result = action.renderMetric("reads", "my-ns", makeMetrics(), "24h");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include namespace name in SVG", () => {
      const svg = decodeSvg(action.renderMetric("reads", "my-ns", makeMetrics(), "24h"));
      expect(svg).toContain("my-ns");
    });

    it("should include formatted metric value", () => {
      const svg = decodeSvg(action.renderMetric("reads", "n", makeMetrics(), "24h"));
      expect(svg).toContain("10K");
    });

    it("should include metric label and time range", () => {
      const svg = decodeSvg(action.renderMetric("deletes", "n", makeMetrics(), "7d"));
      expect(svg).toContain("deletes 7d");
    });

    it("should use correct color for deletes", () => {
      const svg = decodeSvg(action.renderMetric("deletes", "n", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderMetric("reads", "longnamespacename", makeMetrics(), "24h", "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longnamespacename");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: KvNamespaceMetric;

    beforeEach(() => {
      action = new KvNamespaceMetric();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { namespaceId: "ns-1" },
          { apiToken: "t", accountId: "a" }
        )
      ).toBe(true);
    });

    it("should return false when namespaceId is missing", () => {
      expect(
        action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings({ namespaceId: "ns-1" }, { accountId: "a" })
      ).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(
        action.hasRequiredSettings({ namespaceId: "ns-1" }, { apiToken: "t" })
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

      const action = new KvNamespaceMetric();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but namespaceId missing", async () => {
      vi.useFakeTimers();

      const action = new KvNamespaceMetric();
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
      const action = new KvNamespaceMetric();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── Key Cycling ──────────────────────────────────────────────────────

  describe("key cycling", () => {
    it("reads → writes", () => {
      const idx = KV_METRIC_CYCLE_ORDER.indexOf("reads");
      const next = KV_METRIC_CYCLE_ORDER[(idx + 1) % KV_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("writes");
    });

    it("writes → deletes", () => {
      const idx = KV_METRIC_CYCLE_ORDER.indexOf("writes");
      const next = KV_METRIC_CYCLE_ORDER[(idx + 1) % KV_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("deletes");
    });

    it("deletes → lists", () => {
      const idx = KV_METRIC_CYCLE_ORDER.indexOf("deletes");
      const next = KV_METRIC_CYCLE_ORDER[(idx + 1) % KV_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("lists");
    });

    it("lists → reads (wraps)", () => {
      const idx = KV_METRIC_CYCLE_ORDER.indexOf("lists");
      const next = KV_METRIC_CYCLE_ORDER[(idx + 1) % KV_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("reads");
    });

    it("cycle order should have 4 metrics", () => {
      expect(KV_METRIC_CYCLE_ORDER).toHaveLength(4);
    });
  });
});
