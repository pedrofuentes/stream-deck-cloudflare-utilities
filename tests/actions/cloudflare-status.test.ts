import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareStatus } from "../../src/actions/cloudflare-status";
import { CloudflareApiClient } from "../../src/services/cloudflare-api-client";

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
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("CloudflareStatus", () => {
  describe("formatStatusTitle", () => {
    let action: CloudflareStatus;

    beforeEach(() => {
      action = new CloudflareStatus();
    });

    it('should return "✓ OK" for "none" indicator', () => {
      expect(action.formatStatusTitle("none")).toBe("✓ OK");
    });

    it('should return "⚠ Minor" for "minor" indicator', () => {
      expect(action.formatStatusTitle("minor")).toBe("⚠ Minor");
    });

    it('should return "✖ Major" for "major" indicator', () => {
      expect(action.formatStatusTitle("major")).toBe("✖ Major");
    });

    it('should return "🔴 Crit" for "critical" indicator', () => {
      expect(action.formatStatusTitle("critical")).toBe("🔴 Crit");
    });

    it('should return "? N/A" for unknown indicator values', () => {
      expect(action.formatStatusTitle("unknown")).toBe("? N/A");
    });

    it('should return "? N/A" for empty string indicator', () => {
      expect(action.formatStatusTitle("")).toBe("? N/A");
    });

    it("should handle case-sensitive indicators correctly", () => {
      // API returns lowercase - uppercase should be treated as unknown
      expect(action.formatStatusTitle("None")).toBe("? N/A");
      expect(action.formatStatusTitle("MINOR")).toBe("? N/A");
      expect(action.formatStatusTitle("Major")).toBe("? N/A");
      expect(action.formatStatusTitle("CRITICAL")).toBe("? N/A");
    });

    it('should return "? N/A" for unexpected status strings', () => {
      expect(action.formatStatusTitle("degraded")).toBe("? N/A");
      expect(action.formatStatusTitle("outage")).toBe("? N/A");
      expect(action.formatStatusTitle("maintenance")).toBe("? N/A");
    });
  });

  // ── Lifecycle Methods ────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should fetch status and set title on appear", async () => {
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
      expect(ev.action.setTitle).toHaveBeenCalledWith("✓ OK");

      vi.useRealTimers();
    });

    it("should set title to ERR when API throws", async () => {
      vi.useFakeTimers();

      const mockClient = {
        getSystemStatus: vi.fn().mockRejectedValue(new Error("API down")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setTitle).toHaveBeenCalledWith("ERR");

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

      expect(ev.action.setTitle).toHaveBeenCalledWith("⚠ Minor");
    });

    it("should set title to ERR on key press when API throws", async () => {
      const mockClient = {
        getSystemStatus: vi.fn().mockRejectedValue(new Error("Network")),
      } as unknown as CloudflareApiClient;

      const action = new CloudflareStatus(mockClient);
      const ev = makeMockEvent({});

      await action.onKeyDown(ev);

      expect(ev.action.setTitle).toHaveBeenCalledWith("ERR");
    });
  });
});
