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
import type { D1Metrics, D1MetricType } from "../../src/types/cloudflare-d1";
import { D1_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-d1";

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("D1DatabaseMetric", () => {
  // ── truncateDbName ───────────────────────────────────────────────────

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

  // ── metricColor ──────────────────────────────────────────────────────

  describe("metricColor", () => {
    it("should return blue for reads", () => {
      expect(metricColor("reads")).toBe(STATUS_COLORS.blue);
    });

    it("should return amber for writes", () => {
      expect(metricColor("writes")).toBe(STATUS_COLORS.amber);
    });

    it("should return blue for rows_read", () => {
      expect(metricColor("rows_read")).toBe(STATUS_COLORS.blue);
    });

    it("should return amber for rows_written", () => {
      expect(metricColor("rows_written")).toBe(STATUS_COLORS.amber);
    });

    it("should return green for db_size", () => {
      expect(metricColor("db_size")).toBe(STATUS_COLORS.green);
    });

    it("should return gray for unknown metric", () => {
      expect(metricColor("unknown" as D1MetricType)).toBe(STATUS_COLORS.gray);
    });
  });

  // ── formatMetricValue ────────────────────────────────────────────────

  describe("formatMetricValue", () => {
    const metrics = makeMetrics();

    it("should format reads as compact number", () => {
      expect(formatMetricValue("reads", metrics)).toBe("5K");
    });

    it("should format writes as compact number", () => {
      expect(formatMetricValue("writes", metrics)).toBe("200");
    });

    it("should format rows_read as compact number", () => {
      expect(formatMetricValue("rows_read", metrics)).toBe("15K");
    });

    it("should format rows_written as compact number", () => {
      expect(formatMetricValue("rows_written", metrics)).toBe("600");
    });

    it("should format db_size as bytes", () => {
      // 2048000 ≈ 1.95 MB
      const result = formatMetricValue("db_size", metrics);
      expect(result).toMatch(/MB/);
    });

    it("should return N/A for unknown metric", () => {
      expect(formatMetricValue("unknown" as D1MetricType, metrics)).toBe("N/A");
    });

    it("should format zero values correctly", () => {
      const zeros = makeMetrics({
        readQueries: 0,
        writeQueries: 0,
        rowsRead: 0,
        rowsWritten: 0,
        databaseSizeBytes: 0,
      });
      expect(formatMetricValue("reads", zeros)).toBe("0");
      expect(formatMetricValue("writes", zeros)).toBe("0");
      expect(formatMetricValue("rows_read", zeros)).toBe("0");
      expect(formatMetricValue("rows_written", zeros)).toBe("0");
      expect(formatMetricValue("db_size", zeros)).toBe("0B");
    });
  });

  // ── renderMetric ─────────────────────────────────────────────────────

  describe("renderMetric", () => {
    let action: D1DatabaseMetric;

    beforeEach(() => {
      action = new D1DatabaseMetric();
    });

    it("should return a data URI", () => {
      const result = action.renderMetric("reads", "my-db", makeMetrics(), "24h");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include db name in SVG", () => {
      const svg = decodeSvg(action.renderMetric("reads", "my-db", makeMetrics(), "24h"));
      expect(svg).toContain("my-db");
    });

    it("should include formatted metric value", () => {
      const svg = decodeSvg(action.renderMetric("reads", "d", makeMetrics(), "24h"));
      expect(svg).toContain("5K");
    });

    it("should include metric label and time range", () => {
      const svg = decodeSvg(action.renderMetric("rows_read", "d", makeMetrics(), "7d"));
      expect(svg).toContain("rows rd 7d");
    });

    it("should use correct color for writes", () => {
      const svg = decodeSvg(action.renderMetric("writes", "d", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.amber);
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderMetric("reads", "longdbname", makeMetrics(), "24h", "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longdbname");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: D1DatabaseMetric;

    beforeEach(() => {
      action = new D1DatabaseMetric();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { databaseId: "db-1" },
          { apiToken: "t", accountId: "a" }
        )
      ).toBe(true);
    });

    it("should return false when databaseId is missing", () => {
      expect(
        action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings({ databaseId: "db-1" }, { accountId: "a" })
      ).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(
        action.hasRequiredSettings({ databaseId: "db-1" }, { apiToken: "t" })
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

      const action = new D1DatabaseMetric();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but databaseId missing", async () => {
      vi.useFakeTimers();

      const action = new D1DatabaseMetric();
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
      const action = new D1DatabaseMetric();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── Key Cycling ──────────────────────────────────────────────────────

  describe("key cycling", () => {
    it("reads → writes", () => {
      const idx = D1_METRIC_CYCLE_ORDER.indexOf("reads");
      const next = D1_METRIC_CYCLE_ORDER[(idx + 1) % D1_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("writes");
    });

    it("writes → rows_read", () => {
      const idx = D1_METRIC_CYCLE_ORDER.indexOf("writes");
      const next = D1_METRIC_CYCLE_ORDER[(idx + 1) % D1_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("rows_read");
    });

    it("rows_read → rows_written", () => {
      const idx = D1_METRIC_CYCLE_ORDER.indexOf("rows_read");
      const next = D1_METRIC_CYCLE_ORDER[(idx + 1) % D1_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("rows_written");
    });

    it("rows_written → db_size", () => {
      const idx = D1_METRIC_CYCLE_ORDER.indexOf("rows_written");
      const next = D1_METRIC_CYCLE_ORDER[(idx + 1) % D1_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("db_size");
    });

    it("db_size → reads (wraps)", () => {
      const idx = D1_METRIC_CYCLE_ORDER.indexOf("db_size");
      const next = D1_METRIC_CYCLE_ORDER[(idx + 1) % D1_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("reads");
    });

    it("cycle order should have 5 metrics", () => {
      expect(D1_METRIC_CYCLE_ORDER).toHaveLength(5);
    });
  });
});
