/**
 * Tests for the DNS Record Monitor action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DnsRecordMonitor } from "../../src/actions/dns-record-monitor";
import { truncateDomainName, type DnsRecordStatus } from "../../src/services/cloudflare-dns-api";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";

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

function makeRecord(overrides?: Partial<DnsRecordStatus>): DnsRecordStatus {
  return {
    name: "example.com",
    type: "A",
    content: "192.168.1.1",
    proxied: true,
    ttl: 1,
    found: true,
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DnsRecordMonitor", () => {
  // ── renderRecord ─────────────────────────────────────────────────────

  describe("renderRecord", () => {
    let action: DnsRecordMonitor;

    beforeEach(() => {
      action = new DnsRecordMonitor();
    });

    it("should return a data URI", () => {
      const result = action.renderRecord(makeRecord());
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should show green for proxied record", () => {
      const svg = decodeSvg(action.renderRecord(makeRecord({ proxied: true })));
      expect(svg).toContain(STATUS_COLORS.green);
      expect(svg).toContain("proxied");
    });

    it("should show blue for DNS-only record", () => {
      const svg = decodeSvg(action.renderRecord(makeRecord({ proxied: false })));
      expect(svg).toContain(STATUS_COLORS.blue);
      expect(svg).toContain("DNS only");
    });

    it("should show red for missing record", () => {
      const svg = decodeSvg(action.renderRecord(makeRecord({ found: false })));
      expect(svg).toContain(STATUS_COLORS.red);
      expect(svg).toContain("MISSING");
    });

    it("should include record content", () => {
      const svg = decodeSvg(action.renderRecord(makeRecord({ content: "1.2.3" })));
      expect(svg).toContain("1.2.3");
    });

    it("should truncate long content for line2 (30px font, 7 char limit)", () => {
      const svg = decodeSvg(
        action.renderRecord(makeRecord({ content: "192.168.1.1" }))
      );
      expect(svg).toContain("192.16…");
    });

    it("should include record type in display", () => {
      const svg = decodeSvg(action.renderRecord(makeRecord({ type: "CNAME" })));
      expect(svg).toContain("CNAME");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: DnsRecordMonitor;

    beforeEach(() => {
      action = new DnsRecordMonitor();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { zoneId: "z1", recordName: "example.com" },
          { apiToken: "t" }
        )
      ).toBe(true);
    });

    it("should return false when zoneId is missing", () => {
      expect(
        action.hasRequiredSettings(
          { recordName: "example.com" },
          { apiToken: "t" }
        )
      ).toBe(false);
    });

    it("should return false when recordName is missing", () => {
      expect(
        action.hasRequiredSettings({ zoneId: "z1" }, { apiToken: "t" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings(
          { zoneId: "z1", recordName: "example.com" },
          {}
        )
      ).toBe(false);
    });
  });

  // ── hasCredentials ───────────────────────────────────────────────────

  describe("hasCredentials", () => {
    let action: DnsRecordMonitor;

    beforeEach(() => {
      action = new DnsRecordMonitor();
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

      const action = new DnsRecordMonitor();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but settings missing", async () => {
      vi.useFakeTimers();

      const action = new DnsRecordMonitor();
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
      const action = new DnsRecordMonitor();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── truncateDomainName ───────────────────────────────────────────────

  describe("truncateDomainName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateDomainName("example.co")).toBe("example.co");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateDomainName("long-domain.example.com")).toBe("long-doma…");
    });

    it("should handle empty string", () => {
      expect(truncateDomainName("")).toBe("");
    });
  });
});
