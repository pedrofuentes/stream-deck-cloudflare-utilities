/**
 * Tests for the AI Gateway Metric action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AiGatewayMetric,
  truncateGatewayName,
  metricColor,
  formatMetricValue,
} from "../../src/actions/ai-gateway-metric";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type { AiGatewayMetrics, AiGatewayMetricType } from "../../src/types/cloudflare-ai-gateway";

// Mock the global settings store
let capturedGlobalListener: ((settings: Record<string, unknown>) => void) | null = null;
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(),
  onGlobalSettingsChanged: vi.fn().mockImplementation((fn: (settings: Record<string, unknown>) => void) => {
    capturedGlobalListener = fn;
    return vi.fn();
  }),
}));

// Mock the @elgato/streamdeck module
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    },
    actions: {
      registerAction: vi.fn(),
    },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

// Track mock methods
let mockGetMetrics: ReturnType<typeof vi.fn>;
let mockListGateways: ReturnType<typeof vi.fn>;

// Mock the AI Gateway API service
vi.mock("../../src/services/cloudflare-ai-gateway-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-ai-gateway-api")>();
  return {
    ...orig,
    CloudflareAiGatewayApi: class MockCloudflareAiGatewayApi {
      constructor() {
        this.getMetrics = mockGetMetrics;
        this.listGateways = mockListGateways;
      }
      getMetrics: ReturnType<typeof vi.fn>;
      listGateways: ReturnType<typeof vi.fn>;
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

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

function makeMetrics(overrides?: Partial<AiGatewayMetrics>): AiGatewayMetrics {
  return {
    requests: 1500,
    tokens: 80_000,
    tokensIn: 50_000,
    tokensOut: 30_000,
    cachedTokens: 20_000,
    cost: 4.52,
    errors: 3,
    logsStored: 42_000,
    ...overrides,
  };
}

const VALID_SETTINGS = {
  gatewayId: "my-gateway",
  metric: "requests" as const,
  timeRange: "24h" as const,
};

// ── truncateGatewayName ──────────────────────────────────────────────────────

describe("truncateGatewayName", () => {
  it("should return short names unchanged", () => {
    expect(truncateGatewayName("gw-1")).toBe("gw-1");
  });

  it("should return 10-char names unchanged", () => {
    expect(truncateGatewayName("1234567890")).toBe("1234567890");
  });

  it("should truncate names longer than 10 chars", () => {
    expect(truncateGatewayName("12345678901")).toBe("123456789…");
  });

  it("should truncate long names", () => {
    expect(truncateGatewayName("my-super-long-gateway-name")).toBe("my-super-…");
  });

  it("should handle empty string", () => {
    expect(truncateGatewayName("")).toBe("");
  });
});

// ── metricColor ──────────────────────────────────────────────────────────────

describe("metricColor", () => {
  it("should return blue for requests", () => {
    expect(metricColor("requests")).toBe(STATUS_COLORS.blue);
  });

  it("should return blue for tokens", () => {
    expect(metricColor("tokens")).toBe(STATUS_COLORS.blue);
  });

  it("should return green for cost", () => {
    expect(metricColor("cost")).toBe(STATUS_COLORS.green);
  });

  it("should return red for errors", () => {
    expect(metricColor("errors")).toBe(STATUS_COLORS.red);
  });

  it("should return red for error_rate", () => {
    expect(metricColor("error_rate")).toBe(STATUS_COLORS.red);
  });

  it("should return green for cache_hit_rate", () => {
    expect(metricColor("cache_hit_rate")).toBe(STATUS_COLORS.green);
  });

  it("should return blue for logs_stored", () => {
    expect(metricColor("logs_stored")).toBe(STATUS_COLORS.blue);
  });

  it("should return gray for unknown metric", () => {
    expect(metricColor("unknown" as AiGatewayMetricType)).toBe(STATUS_COLORS.gray);
  });
});

// ── formatMetricValue ────────────────────────────────────────────────────────

describe("formatMetricValue", () => {
  const metrics = makeMetrics();

  it("should format requests", () => {
    expect(formatMetricValue("requests", metrics)).toBe("1.5K");
  });

  it("should format tokens", () => {
    expect(formatMetricValue("tokens", metrics)).toBe("80K");
  });

  it("should format cost", () => {
    expect(formatMetricValue("cost", metrics)).toBe("$4.52");
  });

  it("should format errors", () => {
    expect(formatMetricValue("errors", metrics)).toBe("3");
  });

  it("should format error_rate as percentage", () => {
    expect(formatMetricValue("error_rate", metrics)).toBe("0.2%");
  });

  it("should format error_rate as 0% when no requests", () => {
    const zeroReqs = makeMetrics({ requests: 0, errors: 0 });
    expect(formatMetricValue("error_rate", zeroReqs)).toBe("0%");
  });

  it("should format cache_hit_rate as percentage", () => {
    // cachedTokens=20000, tokens=80000 → 25%
    expect(formatMetricValue("cache_hit_rate", metrics)).toBe("25%");
  });

  it("should format cache_hit_rate as 0% when no tokens", () => {
    const zeroTokens = makeMetrics({ tokens: 0, cachedTokens: 0 });
    expect(formatMetricValue("cache_hit_rate", zeroTokens)).toBe("0%");
  });

  it("should format cache_hit_rate with decimal when not round", () => {
    const m = makeMetrics({ tokens: 1000, cachedTokens: 333 });
    expect(formatMetricValue("cache_hit_rate", m)).toBe("33.3%");
  });

  it("should format logs_stored", () => {
    expect(formatMetricValue("logs_stored", metrics)).toBe("42K");
  });

  it("should return N/A for unknown metric", () => {
    expect(formatMetricValue("unknown" as AiGatewayMetricType, metrics)).toBe("N/A");
  });

  it("should format zero values", () => {
    const zeroMetrics = makeMetrics({
      requests: 0,
      tokens: 0,
      cachedTokens: 0,
      cost: 0,
      errors: 0,
      logsStored: 0,
    });
    expect(formatMetricValue("requests", zeroMetrics)).toBe("0");
    expect(formatMetricValue("tokens", zeroMetrics)).toBe("0");
    expect(formatMetricValue("cost", zeroMetrics)).toBe("$0");
    expect(formatMetricValue("errors", zeroMetrics)).toBe("0");
    expect(formatMetricValue("error_rate", zeroMetrics)).toBe("0%");
    expect(formatMetricValue("cache_hit_rate", zeroMetrics)).toBe("0%");
    expect(formatMetricValue("logs_stored", zeroMetrics)).toBe("0");
  });
});

// ── AiGatewayMetric Action ───────────────────────────────────────────────────

describe("AiGatewayMetric", () => {
  let action: AiGatewayMetric;

  beforeEach(() => {
    action = new AiGatewayMetric();
    mockGetMetrics = vi.fn();
    mockListGateways = vi.fn();
    capturedGlobalListener = null;
    vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "test-token", accountId: "test-account" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPollingCoordinator();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── hasRequiredSettings ────────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    it("should return true with all required settings", () => {
      expect(action.hasRequiredSettings(VALID_SETTINGS)).toBe(true);
    });

    it("should return false without apiToken", () => {
      vi.mocked(getGlobalSettings).mockReturnValue({ accountId: "test-account" });
      expect(action.hasRequiredSettings(VALID_SETTINGS)).toBe(false);
    });

    it("should return false without accountId", () => {
      vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "test-token" });
      expect(action.hasRequiredSettings(VALID_SETTINGS)).toBe(false);
    });

    it("should return false without gatewayId", () => {
      expect(action.hasRequiredSettings({ ...VALID_SETTINGS, gatewayId: "" })).toBe(false);
    });

    it("should return false with empty settings", () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      expect(action.hasRequiredSettings({})).toBe(false);
    });

    it("should return false with undefined values", () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      expect(
        action.hasRequiredSettings({
          gatewayId: undefined,
        })
      ).toBe(false);
    });
  });

  // ── renderMetric ───────────────────────────────────────────────────────

  describe("renderMetric", () => {
    const metrics = makeMetrics();

    it("should render requests metric", () => {
      const image = action.renderMetric("requests", "my-gw", metrics, "24h");
      const svg = decodeSvg(image);

      expect(svg).toContain("my-gw");
      expect(svg).toContain("1.5K");
      expect(svg).toContain("reqs 24h");
      expect(svg).toContain(STATUS_COLORS.blue);
    });

    it("should render tokens metric", () => {
      const image = action.renderMetric("tokens", "my-gw", metrics, "7d");
      const svg = decodeSvg(image);

      expect(svg).toContain("80K");
      expect(svg).toContain("tokens 7d");
      expect(svg).toContain(STATUS_COLORS.blue);
    });

    it("should render cost metric with green accent", () => {
      const image = action.renderMetric("cost", "my-gw", metrics, "30d");
      const svg = decodeSvg(image);

      expect(svg).toContain("$4.52");
      expect(svg).toContain("cost 30d");
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should render errors metric with red accent", () => {
      const image = action.renderMetric("errors", "my-gw", metrics, "24h");
      const svg = decodeSvg(image);

      expect(svg).toContain("3");
      expect(svg).toContain("errors 24h");
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should render error_rate metric with red accent", () => {
      const image = action.renderMetric("error_rate", "my-gw", metrics, "24h");
      const svg = decodeSvg(image);

      expect(svg).toContain("0.2%");
      expect(svg).toContain("err rate 24h");
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should render cache_hit_rate metric with green accent", () => {
      const image = action.renderMetric("cache_hit_rate", "my-gw", metrics, "7d");
      const svg = decodeSvg(image);

      expect(svg).toContain("25%");
      expect(svg).toContain("cache 7d");
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should render logs_stored without time range suffix", () => {
      const image = action.renderMetric("logs_stored", "my-gw", metrics);
      const svg = decodeSvg(image);

      expect(svg).toContain("42K");
      expect(svg).toContain("stored");
      // Should NOT have a time range suffix
      expect(svg).not.toContain("stored 24h");
    });

    it("should truncate long gateway names", () => {
      const image = action.renderMetric("requests", "super-long-gateway-name", metrics, "24h");
      const svg = decodeSvg(image);

      expect(svg).toContain("super-lon…");
    });

    it("should default to 24h when timeRange is undefined", () => {
      const image = action.renderMetric("requests", "gw", metrics);
      const svg = decodeSvg(image);

      expect(svg).toContain("reqs 24h");
    });

    it("should use displayName when provided (marquee text)", () => {
      const image = action.renderMetric("requests", "super-long-gateway-name", metrics, "24h", "super-long");
      const svg = decodeSvg(image);

      expect(svg).toContain("super-long");
      expect(svg).not.toContain("super-lon\u2026");
    });
  });

  // ── Polling via coordinator ─────────────────────────────────────────────

  describe("coordinator polling", () => {
    it("should subscribe to the coordinator on appear", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(getPollingCoordinator().subscriberCount).toBeGreaterThanOrEqual(1);
    });

    it("should set isErrorState and skipUntil after error", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("API error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // The action should be in error state with a future skipUntil
      expect((action as any).isErrorState).toBe(true);
      expect((action as any).skipUntil).toBeGreaterThan(Date.now() - 1000);
    });

    it("should reset error state after successful fetch", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect((action as any).isErrorState).toBe(true);

      // Next coordinator tick succeeds
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      (action as any).skipUntil = 0; // clear backoff for test
      await getPollingCoordinator().tick();

      expect((action as any).isErrorState).toBe(false);
      expect((action as any).skipUntil).toBe(0);
    });
  });

  // ── onWillAppear ───────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    it("should show setup image when credentials are missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      expect(svg).toContain("Please");
    });

    it("should show placeholder when credentials present but gatewayId missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledTimes(1);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should fetch and display metrics when settings are valid", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect(mockGetMetrics).toHaveBeenCalledWith("my-gateway", "24h");
      // First call is loading state "...", second is actual data
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);

      // Loading state
      const loadingSvg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(loadingSvg).toContain("...");

      // Actual data
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("1.5K");
      expect(svg).toContain("my-gateway");
    });

    it("should show error when API call fails", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Network error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // First call is loading state, second is ERR
      expect(ev.action.setImage).toHaveBeenCalledTimes(2);
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("ERR");
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should default metric to requests when not set", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({
        gatewayId: "gw",
      });
      await action.onWillAppear(ev);

      // calls[0] is loading, calls[1] is actual data
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("reqs 24h");
    });

    it("should default timeRange to 24h when not set", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent({
        gatewayId: "gw",
        metric: "cost",
      });
      await action.onWillAppear(ev);

      expect(mockGetMetrics).toHaveBeenCalledWith("gw", "24h");
    });

    it("should schedule a refresh after initial fetch", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // First call was immediate
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);

      // Advance by the refresh interval
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetMetrics).toHaveBeenCalledTimes(2);
    });

    it("should not create duplicate timer chains if global settings arrive during fetch", async () => {
      // Simulate: onWillAppear starts a fetch, global settings fire mid-flight
      let resolveFirst!: (v: AiGatewayMetrics) => void;
      const slowFirst = new Promise<AiGatewayMetrics>((r) => { resolveFirst = r; });
      mockGetMetrics.mockReturnValueOnce(slowFirst);

      const ev = makeMockEvent(VALID_SETTINGS);
      // Start onWillAppear — it will block on the slow fetch
      const willAppearPromise = action.onWillAppear(ev);

      // Flush microtasks so onWillAppear gets past the loading state render
      // and consumes slowFirst before the global handler runs
      await Promise.resolve();
      await Promise.resolve();

      // While fetch is in-flight, simulate global settings arriving
      // This triggers onGlobalSettingsChanged which starts a SECOND fetch
      mockGetMetrics.mockResolvedValueOnce(makeMetrics({ requests: 999 }));
      vi.mocked(getGlobalSettings).mockReturnValue({
        apiToken: "test-token",
        accountId: "test-account-id",
      });
      // Use the captured callback from the mock
      expect(capturedGlobalListener).not.toBeNull();
      await capturedGlobalListener!({ apiToken: "test-token", accountId: "test-account-id" });

      // The second fetch completed — key should show the result
      expect(ev.action.setImage).toHaveBeenCalled();
      ev.action.setImage.mockClear();

      // Now resolve the first (stale) fetch
      resolveFirst(makeMetrics({ requests: 1 }));
      await willAppearPromise;

      // The stale fetch should NOT have rendered (generation was superseded)
      expect(ev.action.setImage).not.toHaveBeenCalled();

      // Only ONE timer chain should be running — advance and check call count
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const callsBefore = mockGetMetrics.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      // Should have made exactly 1 more call (one timer), not 2 (no duplicate chain)
      expect(mockGetMetrics.mock.calls.length).toBe(callsBefore + 1);
    });
  });

  // ── onDidReceiveSettings ───────────────────────────────────────────────

  describe("onDidReceiveSettings", () => {
    it("should show setup image when credentials become missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      expect(svg).toContain("Please");
    });

    it("should show placeholder when credentials present but gatewayId becomes missing", async () => {
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
    });

    it("should restart polling with new settings", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);

      // Change to a different gateway
      const ev2 = makeMockEvent({
        ...VALID_SETTINGS,
        gatewayId: "new-gateway",
      });
      await action.onDidReceiveSettings(ev2);

      expect(mockGetMetrics).toHaveBeenCalledWith("new-gateway", "24h");
    });

    it("should clear cached metrics on settings change", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);

      // Now change settings to incomplete (credentials removed)
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev2 = makeMockEvent({});
      await action.onDidReceiveSettings(ev2);

      // Setup image shown when credentials are missing
      const svg = decodeSvg(ev2.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      expect(svg).toContain("Please");
    });

    it("should reuse cached metrics when only display metric changes", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);

      // Change only the metric — same gateway and timeRange
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, metric: "cost" });
      await action.onDidReceiveSettings(ev2);

      // Should NOT have made another API call
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      // Should have rendered with the cost metric from cached data
      const svg = decodeSvg(ev2.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("$4.52");
    });

    it("should refetch when timeRange changes", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev1 = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev1);
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);

      // Change timeRange — should refetch
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, timeRange: "7d" });
      await action.onDidReceiveSettings(ev2);

      expect(mockGetMetrics).toHaveBeenCalledTimes(2);
      expect(mockGetMetrics).toHaveBeenCalledWith("my-gateway", "7d");
    });
  });

  // ── onWillDisappear ────────────────────────────────────────────────────

  describe("onWillDisappear", () => {
    it("should clean up without error", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // Should not throw
      action.onWillDisappear(ev);
    });

    it("should stop polling", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect(mockGetMetrics).toHaveBeenCalledTimes(1);

      action.onWillDisappear(ev);

      // Advance time — should NOT trigger another fetch
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    });
  });

  // ── onKeyDown (metric cycling) ─────────────────────────────────────────

  describe("onKeyDown", () => {
    it("should cycle from requests to tokens", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // Should save settings with next metric
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "tokens" })
      );
    });

    it("should cycle from tokens to cost", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "tokens" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "tokens" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "cost" })
      );
    });

    it("should cycle from cost to errors", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "cost" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "cost" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "errors" })
      );
    });

    it("should cycle from errors to error_rate", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "errors" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "errors" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "error_rate" })
      );
    });

    it("should cycle from error_rate to cache_hit_rate", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "error_rate" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "error_rate" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "cache_hit_rate" })
      );
    });

    it("should cycle from cache_hit_rate to logs_stored", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "cache_hit_rate" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "cache_hit_rate" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "logs_stored" })
      );
    });

    it("should cycle from logs_stored back to requests", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent({ ...VALID_SETTINGS, metric: "logs_stored" });
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "logs_stored" });
      await action.onKeyDown(keyEv);

      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "requests" })
      );
    });

    it("should default to requests when metric is not set", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: undefined });
      await action.onKeyDown(keyEv);

      // "requests" → next is "tokens"
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "tokens" })
      );
    });

    it("should use cached data for display (no extra API call)", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect(mockGetMetrics).toHaveBeenCalledTimes(1);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // Should NOT have made another API call
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      // But should have updated the display
      expect(keyEv.action.setImage).toHaveBeenCalled();
    });

    it("should render the new metric value after cycling", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // Image should show tokens value (next metric after requests)
      const svg = decodeSvg(keyEv.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("80K"); // tokens value
      expect(svg).toContain("tokens 24h");
    });

    it("should do nothing when settings are incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);

      expect(ev.action.setSettings).not.toHaveBeenCalled();
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should not fetch on key press without cache (defers to onDidReceiveSettings)", async () => {
      // Don't call onWillAppear first — simulate a fresh state
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // onKeyDown no longer fetches directly — it calls setSettings which
      // triggers onDidReceiveSettings to handle the fetch
      expect(keyEv.action.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "tokens" })
      );
      // No direct setImage from onKeyDown when there's no cache
      expect(keyEv.action.setImage).not.toHaveBeenCalled();
    });

    it("should set pendingKeyCycle flag so onDidReceiveSettings skips re-render", async () => {
      // Simulate full key press -> onDidReceiveSettings flow
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      // Press key — cycles from "requests" to "tokens"
      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // onKeyDown renders "tokens" from cache
      expect(keyEv.action.setImage).toHaveBeenCalledTimes(1);
      const keySvg = decodeSvg(keyEv.action.setImage.mock.calls[0][0]);
      expect(keySvg).toContain("tokens 24h");

      // Now simulate the onDidReceiveSettings triggered by setSettings
      const settingsEv = makeMockEvent({ ...VALID_SETTINGS, metric: "tokens" });
      await action.onDidReceiveSettings(settingsEv);

      // onDidReceiveSettings should NOT have re-rendered (pendingKeyCycle flag)
      expect(settingsEv.action.setImage).not.toHaveBeenCalled();
      // But should NOT have made another API call
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    });

    it("should not revert metric even if a second onDidReceiveSettings fires", async () => {
      // Regression test: if onDidReceiveSettings fires twice after a key press
      // (e.g., SDK echo + PI echo), the display must NOT revert to the old metric.
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // Press key — cycles from "requests" to "tokens"
      const keyEv = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // First onDidReceiveSettings (from setSettings) — pendingKeyCycle consumed
      const settingsEv1 = makeMockEvent({ ...VALID_SETTINGS, metric: "tokens" });
      await action.onDidReceiveSettings(settingsEv1);

      // Second onDidReceiveSettings (e.g., PI echo) — pendingKeyCycle already false
      const settingsEv2 = makeMockEvent({ ...VALID_SETTINGS, metric: "tokens" });
      await action.onDidReceiveSettings(settingsEv2);

      // Should render tokens, NOT requests (displayMetric is authoritative)
      if (settingsEv2.action.setImage.mock.calls.length > 0) {
        const svg = decodeSvg(settingsEv2.action.setImage.mock.calls[0][0]);
        expect(svg).toContain("tokens 24h");
        expect(svg).not.toContain("reqs 24h");
      }
    });
  });

  // ── Error back-off polling ─────────────────────────────────────────────

  describe("error back-off polling", () => {
    it("should set skipUntil for backoff after error", async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // After error, skipUntil should be set to a future timestamp
      // (Date.now() + 2 * intervalMs = 0 + 120_000 with fake timers at t=0)
      expect((action as any).isErrorState).toBe(true);
      expect((action as any).skipUntil).toBeGreaterThan(0);
    });

    it("should recover to normal interval after successful fetch", async () => {
      // First call fails
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      expect((action as any).isErrorState).toBe(true);
      expect((action as any).skipUntil).toBeGreaterThan(0);

      // Next coordinator tick (after backoff clears) succeeds
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      (action as any).skipUntil = 0; // simulate backoff expired
      await getPollingCoordinator().tick();

      expect((action as any).isErrorState).toBe(false);
      expect((action as any).skipUntil).toBe(0);
    });

    it("should keep cached display when refresh fails", async () => {
      // First call succeeds
      mockGetMetrics.mockResolvedValueOnce(makeMetrics({ requests: 42 }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // Verify initial render shows the metric (calls[0]=loading, calls[1]=data)
      const firstSvg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(firstSvg).toContain("42");
      ev.action.setImage.mockClear();

      // Next poll fails
      mockGetMetrics.mockRejectedValueOnce(new Error("Rate limited"));
      await vi.advanceTimersByTimeAsync(60_000);

      // Should NOT have rendered ERR — display stays on cached data
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should show ERR only when no cached data exists", async () => {
      // First call fails — no cache to fall back to
      mockGetMetrics.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);

      // calls[0]=loading, calls[1]=ERR
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("ERR");
    });

    it("should not render stale metric after settings change during fetch", async () => {
      // Simulate: timer fires (fetch in-flight), user changes settings mid-fetch
      // The stale callback should abort and NOT overwrite the new metric.

      // Set up a slow fetch that we can control
      let resolveSlowFetch!: (v: AiGatewayMetrics) => void;
      mockGetMetrics.mockReturnValueOnce(makeMetrics()); // first call (onWillAppear) - instant
      const ev1 = makeMockEvent({ ...VALID_SETTINGS, metric: "requests" });
      await action.onWillAppear(ev1);

      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      ev1.action.setImage.mockClear();

      // Now set up a slow fetch for the timer callback
      const slowPromise = new Promise<AiGatewayMetrics>((resolve) => {
        resolveSlowFetch = resolve;
      });
      mockGetMetrics.mockReturnValueOnce(slowPromise);

      // Advance timer — triggers fetch (which blocks on slowPromise)
      vi.advanceTimersByTime(60_000);

      // While fetch is in-flight, change gateway (data-affecting change)
      mockGetMetrics.mockResolvedValueOnce(makeMetrics({ requests: 9999 }));
      const ev2 = makeMockEvent({
        ...VALID_SETTINGS,
        gatewayId: "new-gateway",
        metric: "cost",
      });
      await action.onDidReceiveSettings(ev2);

      // ev2 should have rendered: loading state + cost metric
      expect(ev2.action.setImage).toHaveBeenCalled();
      const lastCall = ev2.action.setImage.mock.calls[ev2.action.setImage.mock.calls.length - 1];
      const costSvg = decodeSvg(lastCall[0]);
      expect(costSvg).toContain("$4.52");
      ev2.action.setImage.mockClear();

      // Now resolve the slow fetch (stale callback)
      resolveSlowFetch(makeMetrics({ requests: 1 }));
      await vi.advanceTimersByTimeAsync(0); // let microtasks settle

      // The stale callback should NOT have rendered on ev1 (old event)
      // and should NOT have scheduled a new timer that overwrites ev2's timer
      expect(ev1.action.setImage).not.toHaveBeenCalled();
    });
  });

  // ── Marquee (gateway name scrolling) ────────────────────────────────

  describe("marquee", () => {
    const LONG_GATEWAY = "kleine-gateway"; // 14 chars > 10
    const LONG_SETTINGS = {
      ...VALID_SETTINGS,
      gatewayId: LONG_GATEWAY,
    };

    it("should show first 10 chars of long gateway name initially", async () => {
      mockGetMetrics.mockResolvedValueOnce(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);

      // calls[0] = loading, calls[1] = data
      const svg = decodeSvg(ev.action.setImage.mock.calls[1][0]);
      expect(svg).toContain("kleine-gat");
      // Should NOT contain the truncate ellipsis
      expect(svg).not.toContain("kleine-ga\u2026");
    });

    it("should scroll gateway name after marquee ticks", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      // Marquee has initial pause of 3 ticks (500ms each = 1500ms)
      // then scrolls 1 char per tick
      // Advance past pause (3 × 500ms) + 1 scroll tick (500ms) = 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      // Should have rendered at least one scrolled frame
      const calls = ev.action.setImage.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // The last render should show scrolled text
      const lastSvg = decodeSvg(calls[calls.length - 1][0]);
      expect(lastSvg).toContain("leine-gate"); // offset 1
    });

    it("should not start marquee for short gateway names", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(VALID_SETTINGS); // "my-gateway" = 10 chars
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      // Advance by several marquee intervals — no extra renders
      await vi.advanceTimersByTimeAsync(3000);

      // Only the poll timer should have fired (at 60s), not at 3s
      // So no setImage calls from marquee
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop marquee on disappear", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      action.onWillDisappear(ev);

      // Advance time — marquee should not fire
      await vi.advanceTimersByTimeAsync(5000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should continue marquee position when cycling metrics", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);

      // Advance to get scrolling started (past pause + 2 scroll steps)
      // 3 pause ticks + 2 scroll ticks = 5 × 500ms = 2500ms
      await vi.advanceTimersByTimeAsync(2500);
      ev.action.setImage.mockClear();

      // Press key to cycle metric — marquee should continue
      const keyEv = makeMockEvent({ ...LONG_SETTINGS, metric: "requests" });
      await action.onKeyDown(keyEv);

      // The render should show the scrolled gateway name (offset 2)
      // with the new metric value
      const svg = decodeSvg(keyEv.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("eine-gatew"); // offset 2
      expect(svg).toContain("tokens 24h"); // cycled to next metric
    });

    it("should reset marquee when gateway changes", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);

      // Scroll a bit
      await vi.advanceTimersByTimeAsync(2500);

      // Change to a different long gateway
      const newGateway = "another-long-gw-name"; // 20 chars
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev2 = makeMockEvent({ ...VALID_SETTINGS, gatewayId: newGateway });
      await action.onDidReceiveSettings(ev2);

      // The last render should show the new gateway at offset 0
      const calls = ev2.action.setImage.mock.calls;
      const lastSvg = decodeSvg(calls[calls.length - 1][0]);
      expect(lastSvg).toContain("another-lo"); // first 10 chars of new gateway
    });

    it("should complete a full circular scroll cycle", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      // kleine-gateway: 14 chars + 5 separator = 19 loop length
      // Full cycle: pause(3) + scroll(19) + pause(3) = 25 ticks
      // The last scroll tick (19th) lands at offset 0.
      // 25 × 500ms = 12500ms
      await vi.advanceTimersByTimeAsync(12500);

      const calls = ev.action.setImage.mock.calls;
      // The last render should show the start position (full loop completed)
      const lastSvg = decodeSvg(calls[calls.length - 1][0]);
      expect(lastSvg).toContain("kleine-gat");
    });

    it("should show separator gap during circular scroll", async () => {
      mockGetMetrics.mockResolvedValue(makeMetrics());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();

      // Advance past pause (3 × 500 = 1500ms) + 10 scroll ticks (5000ms) = 6500ms
      // At offset 10: separator with dot visible, text wrapping back
      await vi.advanceTimersByTimeAsync(6500);

      const calls = ev.action.setImage.mock.calls;
      const lastSvg = decodeSvg(calls[calls.length - 1][0]);
      expect(lastSvg).toContain("eway"); // wrap-around visible
    });
  });
});
