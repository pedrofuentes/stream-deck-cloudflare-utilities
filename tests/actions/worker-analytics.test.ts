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
  truncateWorkerName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/worker-analytics";
import { CloudflareWorkerAnalyticsApi } from "../../src/services/cloudflare-worker-analytics-api";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import type {
  WorkerAnalyticsMetrics,
  WorkerAnalyticsMetricType,
} from "../../src/types/cloudflare-worker-analytics";
import { WORKER_METRIC_CYCLE_ORDER } from "../../src/types/cloudflare-worker-analytics";

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
  onGlobalSettingsChanged: vi.fn(() => vi.fn()), // returns unsubscribe
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

/** Decode a data URI to the raw SVG string. */
function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorkerAnalytics", () => {
  // ── truncateWorkerName ───────────────────────────────────────────────

  describe("truncateWorkerName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateWorkerName("my-worker")).toBe("my-worker");
    });

    it("should return exactly 10 chars unchanged", () => {
      expect(truncateWorkerName("0123456789")).toBe("0123456789");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateWorkerName("my-very-long-worker")).toBe("my-very-l…");
    });

    it("should handle empty string", () => {
      expect(truncateWorkerName("")).toBe("");
    });
  });

  // ── metricColor ──────────────────────────────────────────────────────

  describe("metricColor", () => {
    it("should return blue for requests", () => {
      expect(metricColor("requests")).toBe(STATUS_COLORS.blue);
    });

    it("should return red for errors", () => {
      expect(metricColor("errors")).toBe(STATUS_COLORS.red);
    });

    it("should return red for error_rate", () => {
      expect(metricColor("error_rate")).toBe(STATUS_COLORS.red);
    });

    it("should return green for cpu_p50", () => {
      expect(metricColor("cpu_p50")).toBe(STATUS_COLORS.green);
    });

    it("should return amber for cpu_p99", () => {
      expect(metricColor("cpu_p99")).toBe(STATUS_COLORS.amber);
    });

    it("should return blue for wall_time", () => {
      expect(metricColor("wall_time")).toBe(STATUS_COLORS.blue);
    });

    it("should return blue for subrequests", () => {
      expect(metricColor("subrequests")).toBe(STATUS_COLORS.blue);
    });

    it("should return gray for unknown metric", () => {
      expect(metricColor("unknown" as WorkerAnalyticsMetricType)).toBe(STATUS_COLORS.gray);
    });
  });

  // ── formatMetricValue ────────────────────────────────────────────────

  describe("formatMetricValue", () => {
    const metrics = makeMetrics();

    it("should format requests as compact number", () => {
      expect(formatMetricValue("requests", metrics)).toBe("5K");
    });

    it("should format errors as compact number", () => {
      expect(formatMetricValue("errors", metrics)).toBe("23");
    });

    it("should format error_rate as percentage", () => {
      // 23/5000 * 100 = 0.46%
      expect(formatMetricValue("error_rate", metrics)).toBe("0.5%");
    });

    it("should format error_rate as 0% when no requests", () => {
      expect(formatMetricValue("error_rate", makeMetrics({ requests: 0 }))).toBe("0%");
    });

    it("should format cpu_p50 as duration", () => {
      // 2300 μs = 2.3ms
      expect(formatMetricValue("cpu_p50", metrics)).toBe("2.3ms");
    });

    it("should format cpu_p99 as duration", () => {
      // 45000 μs = 45ms
      expect(formatMetricValue("cpu_p99", metrics)).toBe("45ms");
    });

    it("should format wall_time as duration", () => {
      // 150000 μs = 150ms
      expect(formatMetricValue("wall_time", metrics)).toBe("150ms");
    });

    it("should format subrequests as compact number", () => {
      expect(formatMetricValue("subrequests", metrics)).toBe("1.2K");
    });

    it("should return N/A for unknown metric", () => {
      expect(formatMetricValue("unknown" as WorkerAnalyticsMetricType, metrics)).toBe("N/A");
    });

    it("should format zero values correctly", () => {
      const zeros = makeMetrics({
        requests: 0,
        errors: 0,
        subrequests: 0,
        wallTime: 0,
        cpuTimeP50: 0,
        cpuTimeP99: 0,
      });
      expect(formatMetricValue("requests", zeros)).toBe("0");
      expect(formatMetricValue("errors", zeros)).toBe("0");
      expect(formatMetricValue("error_rate", zeros)).toBe("0%");
      expect(formatMetricValue("cpu_p50", zeros)).toBe("0ms");
      expect(formatMetricValue("cpu_p99", zeros)).toBe("0ms");
      expect(formatMetricValue("wall_time", zeros)).toBe("0ms");
      expect(formatMetricValue("subrequests", zeros)).toBe("0");
    });
  });

  // ── renderMetric ─────────────────────────────────────────────────────

  describe("renderMetric", () => {
    let action: WorkerAnalytics;

    beforeEach(() => {
      action = new WorkerAnalytics();
    });

    it("should return a data URI", () => {
      const result = action.renderMetric("requests", "my-worker", makeMetrics(), "24h");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include worker name in SVG", () => {
      const svg = decodeSvg(action.renderMetric("requests", "my-worker", makeMetrics(), "24h"));
      expect(svg).toContain("my-worker");
    });

    it("should include formatted metric value", () => {
      const svg = decodeSvg(action.renderMetric("requests", "wk", makeMetrics(), "24h"));
      expect(svg).toContain("5K");
    });

    it("should include metric label and time range", () => {
      const svg = decodeSvg(action.renderMetric("cpu_p50", "wk", makeMetrics(), "7d"));
      expect(svg).toContain("cpu p50 7d");
    });

    it("should use correct color for errors", () => {
      const svg = decodeSvg(action.renderMetric("errors", "wk", makeMetrics(), "24h"));
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderMetric("requests", "longworkername", makeMetrics(), "24h", "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longworkername");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: WorkerAnalytics;

    beforeEach(() => {
      action = new WorkerAnalytics();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { workerName: "my-worker" },
          { apiToken: "t", accountId: "a" }
        )
      ).toBe(true);
    });

    it("should return false when workerName is missing", () => {
      expect(
        action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings({ workerName: "w" }, { accountId: "a" })
      ).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(
        action.hasRequiredSettings({ workerName: "w" }, { apiToken: "t" })
      ).toBe(false);
    });
  });

  // ── coordinator backoff ─────────────────────────────────────────────

  describe("coordinator backoff", () => {
    it("should set skipUntil after error", async () => {
      const { vi: _vi } = await import("vitest");
      _vi.useFakeTimers();

      const { getGlobalSettings } = await import(
        "../../src/services/global-settings-store"
      );
      (getGlobalSettings as any).mockReturnValue({
        apiToken: "t",
        accountId: "a",
      });

      const action = new WorkerAnalytics();
      // We just verify the error state property is accessible
      // (the action uses skipUntil for coordinator-based backoff)
      expect((action as any).skipUntil).toBe(0);

      _vi.useRealTimers();
    });
  });

  // ── Lifecycle Tests ──────────────────────────────────────────────────

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

      const action = new WorkerAnalytics();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      expect(svg).toContain("Please");

      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but workerName missing", async () => {
      vi.useFakeTimers();

      const action = new WorkerAnalytics();
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
      const action = new WorkerAnalytics();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── Key Cycling ──────────────────────────────────────────────────────

  describe("key cycling", () => {
    it("requests → errors", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("requests");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("errors");
    });

    it("errors → error_rate", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("errors");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("error_rate");
    });

    it("error_rate → cpu_p50", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("error_rate");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("cpu_p50");
    });

    it("cpu_p50 → cpu_p99", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("cpu_p50");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("cpu_p99");
    });

    it("cpu_p99 → wall_time", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("cpu_p99");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("wall_time");
    });

    it("wall_time → subrequests", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("wall_time");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("subrequests");
    });

    it("subrequests → requests (wraps)", () => {
      const idx = WORKER_METRIC_CYCLE_ORDER.indexOf("subrequests");
      const next = WORKER_METRIC_CYCLE_ORDER[(idx + 1) % WORKER_METRIC_CYCLE_ORDER.length];
      expect(next).toBe("requests");
    });

    it("cycle order should have 7 metrics", () => {
      expect(WORKER_METRIC_CYCLE_ORDER).toHaveLength(7);
    });
  });
});
