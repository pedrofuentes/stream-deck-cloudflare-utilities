/**
 * Tests for the Cloudflare Status action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareStatus } from "../../src/actions/cloudflare-status";
import { CloudflareApiClient } from "../../src/services/cloudflare-api-client";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";
import type { CloudflareComponent } from "../../src/types/cloudflare";

// Mock the @elgato/streamdeck module
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
      error: vi.fn(),
      info: vi.fn(),
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

// Helper to create a mock SD event
function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Decode a data URI to the raw SVG string for assertion convenience. */
function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

describe("CloudflareStatus", () => {
  describe("renderStatusImage", () => {
    let action: CloudflareStatus;

    beforeEach(() => {
      action = new CloudflareStatus();
    });

    it("should return a data URI for none indicator", () => {
      const result = action.renderStatusImage("none");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should show green indicator for none (OK) status", () => {
      const svg = decodeSvg(action.renderStatusImage("none"));
      expect(svg).toContain(STATUS_COLORS.green);
      expect(svg).toContain("OK");
    });

    it("should show amber indicator for minor status", () => {
      const svg = decodeSvg(action.renderStatusImage("minor"));
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Minor");
    });

    it("should show red indicator for major status", () => {
      const svg = decodeSvg(action.renderStatusImage("major"));
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("Major");
    });

    it("should show red indicator for critical status", () => {
      const svg = decodeSvg(action.renderStatusImage("critical"));
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("Critical");
    });

    it("should show gray indicator for unknown indicator values", () => {
      const svg = decodeSvg(action.renderStatusImage("unknown"));
      expect(svg).toContain(STATUS_COLORS.gray);
      expect(svg).toContain("N/A");
    });

    it("should show gray indicator for empty string indicator", () => {
      const svg = decodeSvg(action.renderStatusImage(""));
      expect(svg).toContain(STATUS_COLORS.gray);
    });

    it("should handle case-sensitive indicators correctly", () => {
      // API returns lowercase - uppercase should be treated as unknown
      expect(decodeSvg(action.renderStatusImage("None"))).toContain(STATUS_COLORS.gray);
      expect(decodeSvg(action.renderStatusImage("MINOR"))).toContain(STATUS_COLORS.gray);
      expect(decodeSvg(action.renderStatusImage("Major"))).toContain(STATUS_COLORS.gray);
      expect(decodeSvg(action.renderStatusImage("CRITICAL"))).toContain(STATUS_COLORS.gray);
    });

    it("should show gray indicator for unexpected status strings", () => {
      expect(decodeSvg(action.renderStatusImage("degraded"))).toContain(STATUS_COLORS.gray);
      expect(decodeSvg(action.renderStatusImage("outage"))).toContain(STATUS_COLORS.gray);
      expect(decodeSvg(action.renderStatusImage("maintenance"))).toContain(STATUS_COLORS.gray);
    });

    it("should include Cloudflare label", () => {
      const svg = decodeSvg(action.renderStatusImage("none"));
      expect(svg).toContain("Cloudflare");
    });
  });

  // -- Lifecycle Methods --

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should fetch status and set image on appear", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getSystemStatus: vi.fn().mockResolvedValue({
          indicator: "none",
          description: "All Systems Operational",
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ refreshIntervalSeconds: 120 });

      await action.onWillAppear(ev);

      expect(mockClient.getSystemStatus).toHaveBeenCalled();
      expect(ev.action.setImage).toHaveBeenCalled();
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.green);

      vi.useRealTimers();
    });

    it("should set error image when API throws", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getSystemStatus: vi.fn().mockRejectedValue(new Error("API down")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("ERR");

      vi.useRealTimers();
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up interval without error", () => {
      const action = new CloudflareStatus();
      expect(() => action.onWillDisappear()).not.toThrow();
    });
  });

  describe("onKeyDown", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should refresh status on key press", async () => {
      const mockClient = {
        getSystemStatus: vi.fn().mockResolvedValue({
          indicator: "minor",
          description: "Minor Issue",
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onKeyDown(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.amber);
    });

    it("should set error image on key press when API throws", async () => {
      const mockClient = {
        getSystemStatus: vi.fn().mockRejectedValue(new Error("Network")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onKeyDown(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);
    });
  });

  // -- Component Drill-Down --

  describe("mapComponentStatus", () => {
    it("should map operational to OK/green", () => {
      const result = CloudflareStatus.mapComponentStatus("operational");
      expect(result.label).toBe("OK");
      expect(result.color).toBe(STATUS_COLORS.green);
    });

    it("should map degraded_performance to Degraded/amber", () => {
      const result = CloudflareStatus.mapComponentStatus("degraded_performance");
      expect(result.label).toBe("Degraded");
      expect(result.color).toBe(STATUS_COLORS.amber);
    });

    it("should map partial_outage to Partial/amber", () => {
      const result = CloudflareStatus.mapComponentStatus("partial_outage");
      expect(result.label).toBe("Partial");
      expect(result.color).toBe(STATUS_COLORS.amber);
    });

    it("should map major_outage to Outage/red", () => {
      const result = CloudflareStatus.mapComponentStatus("major_outage");
      expect(result.label).toBe("Outage");
      expect(result.color).toBe(STATUS_COLORS.red);
    });

    it("should map under_maintenance to Maint/blue", () => {
      const result = CloudflareStatus.mapComponentStatus("under_maintenance");
      expect(result.label).toBe("Maint");
      expect(result.color).toBe(STATUS_COLORS.blue);
    });

    it("should map unknown status to N/A/gray", () => {
      const result = CloudflareStatus.mapComponentStatus("unknown_status");
      expect(result.label).toBe("N/A");
      expect(result.color).toBe(STATUS_COLORS.gray);
    });

    it("should map empty string to N/A/gray", () => {
      const result = CloudflareStatus.mapComponentStatus("");
      expect(result.label).toBe("N/A");
      expect(result.color).toBe(STATUS_COLORS.gray);
    });
  });

  describe("renderComponentImage", () => {
    let action: CloudflareStatus;

    beforeEach(() => {
      action = new CloudflareStatus();
    });

    it("should return a data URI", () => {
      const result = action.renderComponentImage("DNS", "operational");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should include component name in SVG", () => {
      const svg = decodeSvg(action.renderComponentImage("DNS", "operational"));
      expect(svg).toContain("DNS");
    });

    it("should show green bar for operational", () => {
      const svg = decodeSvg(action.renderComponentImage("CDN", "operational"));
      expect(svg).toContain(STATUS_COLORS.green);
      expect(svg).toContain("OK");
    });

    it("should show amber bar for degraded_performance", () => {
      const svg = decodeSvg(action.renderComponentImage("Workers", "degraded_performance"));
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Degraded");
    });

    it("should show red bar for major_outage", () => {
      const svg = decodeSvg(action.renderComponentImage("API", "major_outage"));
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("Outage");
    });

    it("should show blue bar for under_maintenance", () => {
      const svg = decodeSvg(action.renderComponentImage("DNS", "under_maintenance"));
      expect(svg).toContain(STATUS_COLORS.blue);
      expect(svg).toContain("Maint");
    });
  });

  describe("component mode lifecycle", () => {
    const MOCK_COMPONENTS: CloudflareComponent[] = [
      { id: "dns-1", name: "DNS", status: "operational", description: null },
      { id: "cdn-2", name: "CDN/Cache", status: "degraded_performance", description: null },
      { id: "wrk-3", name: "Workers", status: "major_outage", description: null },
    ];

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should fetch and display component status on appear", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(MOCK_COMPONENTS),
        getSystemStatus: vi.fn(),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "cdn-2", componentName: "CDN/Cache" });

      await action.onWillAppear(ev);

      expect(mockClient.getComponents).toHaveBeenCalled();
      expect(mockClient.getSystemStatus).not.toHaveBeenCalled();
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Degraded");
      expect(svg).toContain("CDN/Cache");

      vi.useRealTimers();
    });

    it("should fall back to overall status when no componentId set", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getComponents: vi.fn(),
        getSystemStatus: vi.fn().mockResolvedValue({
          indicator: "none",
          description: "All Systems Operational",
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(mockClient.getSystemStatus).toHaveBeenCalled();
      expect(mockClient.getComponents).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should show N/A when component ID not found", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(MOCK_COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "nonexistent", componentName: "Gone" });

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.gray);
      expect(svg).toContain("N/A");
      expect(svg).toContain("Gone");

      vi.useRealTimers();
    });

    it("should show component error state when API fails", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getComponents: vi.fn().mockRejectedValue(new Error("Network")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "dns-1", componentName: "DNS" });

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("ERR");
      expect(svg).toContain("DNS");

      vi.useRealTimers();
    });

    it("should use componentName in error state, fallback to 'Component'", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getComponents: vi.fn().mockRejectedValue(new Error("fail")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "dns-1" }); // no componentName

      await action.onWillAppear(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Component");

      vi.useRealTimers();
    });

    it("should refresh component status on key press", async () => {
      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(MOCK_COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "wrk-3", componentName: "Workers" });

      await action.onKeyDown(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("Outage");
      expect(svg).toContain("Workers");
    });

    it("should use component name from settings when available", async () => {
      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(MOCK_COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "dns-1", componentName: "My DNS" });

      await action.onKeyDown(ev);

      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("My DNS");
    });
  });

  describe("onDidReceiveSettings", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should re-fetch status when settings change", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getSystemStatus: vi.fn().mockResolvedValue({
          indicator: "none",
          description: "OK",
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await (action as any).onDidReceiveSettings(ev);

      expect(mockClient.getSystemStatus).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should switch from overall to component mode on settings change", async () => {
      vi.useFakeTimers();

      const COMPONENTS: CloudflareComponent[] = [
        { id: "dns-1", name: "DNS", status: "partial_outage", description: null },
      ];

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(COMPONENTS),
        getSystemStatus: vi.fn(),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "dns-1", componentName: "DNS" });

      await (action as any).onDidReceiveSettings(ev);

      expect(mockClient.getComponents).toHaveBeenCalled();
      expect(mockClient.getSystemStatus).not.toHaveBeenCalled();
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Partial");
      expect(svg).toContain(STATUS_COLORS.amber);

      vi.useRealTimers();
    });
  });

  describe("error backoff", () => {
    afterEach(() => {
      resetPollingCoordinator();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should skip polls after first error (skip 1)", async () => {
      vi.useFakeTimers();
      getPollingCoordinator().setIntervalSeconds(10);

      const mockClient = {
        getSystemStatus: vi
          .fn()
          .mockRejectedValueOnce(new Error("403"))
          .mockResolvedValue({ indicator: "none", description: "OK" }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      // Initial call — fails (consecutiveErrors = 1, backoff = 2 * 10s = 20s)
      await action.onWillAppear(ev);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(1);

      // First coordinator tick at 10s — within backoff (20s), skipped
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(1); // still 1

      // Second coordinator tick at 20s — backoff expired, makes the call
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should increase backoff exponentially on consecutive errors", async () => {
      vi.useFakeTimers();
      getPollingCoordinator().setIntervalSeconds(10);

      const mockClient = {
        getSystemStatus: vi.fn().mockRejectedValue(new Error("403")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      const coordinator = getPollingCoordinator();

      // Initial call — error #1, backoff = 2 * 10s = 20s (skip 2 ticks)
      await action.onWillAppear(ev);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(1);

      // Skip 2 ticks (20s), then retry — error #2, backoff = 4 * 10s = 40s
      await vi.advanceTimersByTimeAsync(10_000); // skip
      await vi.advanceTimersByTimeAsync(10_000); // call
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(2);

      // Skip 4 ticks (40s), then retry — error #3, backoff = 8 * 10s = 80s
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it("should cap backoff at MAX_BACKOFF_EXPONENT (32x)", async () => {
      vi.useFakeTimers();
      getPollingCoordinator().setIntervalSeconds(1);

      let callCount = 0;
      const mockClient = {
        getSystemStatus: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.reject(new Error("403"));
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      const coordinator = getPollingCoordinator();

      // Initial call — error #1, backoff = 2 * 1s = 2s
      await action.onWillAppear(ev);
      expect(callCount).toBe(1);

      // Error #2: skip 2 ticks, call → backoff = 4s
      for (let i = 0; i < 2; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(2);

      // Error #3: skip 4 ticks, call → backoff = 8s
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(3);

      // Error #4: skip 8 ticks, call → backoff = 16s
      for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(4);

      // Error #5: skip 16 ticks, call → backoff = 32s (capped, exponent=5)
      for (let i = 0; i < 16; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(5);

      // Error #6: skip 32 ticks = capped
      for (let i = 0; i < 32; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(6);

      // Error #7: still 32 ticks (doesn't grow beyond cap)
      for (let i = 0; i < 32; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(callCount).toBe(7);

      vi.useRealTimers();
    });

    it("should reset backoff on successful fetch", async () => {
      vi.useFakeTimers();
      getPollingCoordinator().setIntervalSeconds(10);

      const mockClient = {
        getSystemStatus: vi
          .fn()
          .mockRejectedValueOnce(new Error("403"))  // error #1
          .mockRejectedValueOnce(new Error("403"))  // error #2
          .mockResolvedValueOnce({ indicator: "none", description: "OK" }) // success
          .mockRejectedValueOnce(new Error("403"))  // error again — should be #1 not #3
          .mockResolvedValue({ indicator: "none", description: "OK" }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      // Initial: error #1, backoff = 2 * 10s = 20s
      await action.onWillAppear(ev);

      // Skip 2 ticks, retry: error #2, backoff = 4 * 10s = 40s
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(2);

      // Skip 4 ticks, retry: success → reset backoff
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(3);

      // Next tick should call immediately (backoff reset)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(4); // error again, but backoff = 2*10s

      // Only skip 2 ticks (backoff=20s, not 80s which would be if it was error #3)
      await vi.advanceTimersByTimeAsync(10_000); // skip
      await vi.advanceTimersByTimeAsync(10_000); // call
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(5);

      vi.useRealTimers();
    });

    it("should reset backoff on key press", async () => {
      vi.useFakeTimers();
      getPollingCoordinator().setIntervalSeconds(10);

      const mockClient = {
        getSystemStatus: vi
          .fn()
          .mockRejectedValueOnce(new Error("403"))   // initial error
          .mockRejectedValueOnce(new Error("403"))   // key press error
          .mockResolvedValue({ indicator: "none", description: "OK" }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      // Initial: error #1, backoff = 2 * 10s = 20s
      await action.onWillAppear(ev);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(1);

      // Key press resets backoff and fetches immediately
      await action.onKeyDown(ev);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(2);

      // Key press errored → consecutiveErrors=1, backoff=20s
      // Next tick: skip (within 20s backoff)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(2);

      // Tick after: backoff expired, call succeeds
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockClient.getSystemStatus).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe("marquee scrolling", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should not start marquee for short component names", async () => {
      vi.useFakeTimers();

      const COMPONENTS: CloudflareComponent[] = [
        { id: "dns-1", name: "DNS", status: "operational", description: null },
      ];

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "dns-1", componentName: "DNS" });

      await action.onWillAppear(ev);

      // Advance past marquee interval — no marquee tick should re-render
      const callCount = ev.action.setImage.mock.calls.length;
      await vi.advanceTimersByTimeAsync(2000);
      // setImage should not be called again (no marquee animation)
      // Only the refresh interval would call, but the marquee tick is what matters
      // The component name "DNS" is 3 chars, well under 10
      expect(ev.action.setImage.mock.calls.length).toBe(callCount);

      vi.useRealTimers();
    });

    it("should start marquee for long component names", async () => {
      vi.useFakeTimers();

      const COMPONENTS: CloudflareComponent[] = [
        { id: "auth-1", name: "Access Authentication & SSO", status: "operational", description: null },
      ];

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "auth-1", componentName: "Access Authentication & SSO" });

      await action.onWillAppear(ev);
      const initialCalls = ev.action.setImage.mock.calls.length;

      // Advance past the marquee pause ticks (3 * 500ms) and into scrolling
      await vi.advanceTimersByTimeAsync(3000);

      // Marquee should have re-rendered the key multiple times
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(initialCalls);

      // The re-rendered SVG should contain scrolled text (not the full name)
      const lastCall = ev.action.setImage.mock.calls[ev.action.setImage.mock.calls.length - 1][0];
      const svg = decodeSvg(lastCall);
      // Should contain the status and accent bar color
      expect(svg).toContain(STATUS_COLORS.green);
      expect(svg).toContain("OK");

      vi.useRealTimers();
    });

    it("should not start marquee in overall status mode (Cloudflare is ≤10 chars)", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getSystemStatus: vi.fn().mockResolvedValue({
          indicator: "none",
          description: "All Systems Operational",
        }),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);
      const initialCalls = ev.action.setImage.mock.calls.length;

      await vi.advanceTimersByTimeAsync(3000);

      // No marquee ticks — "Cloudflare" is exactly 10 chars
      expect(ev.action.setImage.mock.calls.length).toBe(initialCalls);

      vi.useRealTimers();
    });

    it("should stop marquee when action disappears", async () => {
      vi.useFakeTimers();

      const COMPONENTS: CloudflareComponent[] = [
        { id: "auth-1", name: "Access Authentication & SSO", status: "operational", description: null },
      ];

      const mockClient = {
        getComponents: vi.fn().mockResolvedValue(COMPONENTS),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({ componentId: "auth-1", componentName: "Access Authentication & SSO" });

      await action.onWillAppear(ev);
      action.onWillDisappear();

      const callCount = ev.action.setImage.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);

      // No more re-renders after disappear
      expect(ev.action.setImage.mock.calls.length).toBe(callCount);

      vi.useRealTimers();
    });
  });
});
