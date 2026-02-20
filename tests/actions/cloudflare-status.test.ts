import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareStatus } from "../../src/actions/cloudflare-status";
import { CloudflareApiClient } from "../../src/services/cloudflare-api-client";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";

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
});
