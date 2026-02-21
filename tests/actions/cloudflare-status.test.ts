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
import type { CloudflareComponent } from "../../src/types/cloudflare";

// Mock the @elgato/streamdeck module
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
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
});
