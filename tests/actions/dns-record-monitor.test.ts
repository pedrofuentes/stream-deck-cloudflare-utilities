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
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator, getPollingCoordinator } from "../../src/services/polling-coordinator";

// ── Mocks ────────────────────────────────────────────────────────────────────

let capturedGlobalListener: ((settings: Record<string, unknown>) => void) | null = null;
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(),
  onGlobalSettingsChanged: vi.fn().mockImplementation((fn: (settings: Record<string, unknown>) => void) => {
    capturedGlobalListener = fn;
    return vi.fn();
  }),
}));

vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { debug: vi.fn(), error: vi.fn(), setLevel: vi.fn() },
    actions: { registerAction: vi.fn() },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

let mockGetRecordStatus: ReturnType<typeof vi.fn>;

vi.mock("../../src/services/cloudflare-dns-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-dns-api")>();
  return {
    ...orig,
    CloudflareDnsApi: class MockCloudflareDnsApi {
      constructor() { this.getRecordStatus = mockGetRecordStatus; }
      getRecordStatus: ReturnType<typeof vi.fn>;
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

function makeRecord(overrides?: Partial<DnsRecordStatus>): DnsRecordStatus {
  return {
    name: "e.com",
    type: "A",
    content: "1.2.3.4",
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

const VALID_SETTINGS = {
  zoneId: "zone-123",
  zoneName: "example.com",
  recordName: "example.com",
  recordType: "A",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateDomainName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateDomainName("example.co")).toBe("example.co"); });
  it("should truncate names > 10 chars", () => { expect(truncateDomainName("long-domain.example.com")).toBe("long-doma…"); });
  it("should handle empty string", () => { expect(truncateDomainName("")).toBe(""); });
});

describe("DnsRecordMonitor", () => {
  let action: DnsRecordMonitor;

  beforeEach(() => {
    action = new DnsRecordMonitor();
    mockGetRecordStatus = vi.fn();
    capturedGlobalListener = null;
    vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "test-token", accountId: "test-account" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPollingCoordinator();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("hasRequiredSettings", () => {
    it("should return true with apiToken, zoneId, and recordName", () => { expect(action.hasRequiredSettings({ zoneId: "z1", recordName: "x.com" }, { apiToken: "t" })).toBe(true); });
    it("should return false without zoneId", () => { expect(action.hasRequiredSettings({ recordName: "x.com" }, { apiToken: "t" })).toBe(false); });
    it("should return false without recordName", () => { expect(action.hasRequiredSettings({ zoneId: "z1" }, { apiToken: "t" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ zoneId: "z1", recordName: "x.com" }, {})).toBe(false); });
  });

  describe("hasCredentials", () => {
    it("should return true with apiToken", () => { expect(action.hasCredentials({ apiToken: "t" })).toBe(true); });
    it("should return false without apiToken", () => { expect(action.hasCredentials({})).toBe(false); });
  });

  describe("renderRecord", () => {
    it("should return a data URI", () => { expect(action.renderRecord(makeRecord())).toMatch(/^data:image\/svg\+xml,/); });
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
    it("should include record content", () => { expect(decodeSvg(action.renderRecord(makeRecord({ content: "1.2.3" })))).toContain("1.2.3"); });
    it("should truncate long content (>7 chars)", () => { expect(decodeSvg(action.renderRecord(makeRecord({ content: "192.168.1.1" })))).toContain("192.16…"); });
    it("should include record type", () => { expect(decodeSvg(action.renderRecord(makeRecord({ type: "CNAME" })))).toContain("CNAME"); });
  });

  describe("onWillAppear", () => {
    it("should show setup image when credentials missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should show placeholder when settings missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display record", async () => {
      mockGetRecordStatus.mockResolvedValueOnce(makeRecord());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetRecordStatus).toHaveBeenCalledWith("zone-123", "example.com", "A", "example.com");
      expect(ev.action.setImage).toHaveBeenCalled();
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("e.com");
    });

    it("should show ERR on API failure", async () => {
      mockGetRecordStatus.mockRejectedValueOnce(new Error("Net error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("ERR");
    });

    it("should schedule refresh via coordinator", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(mockGetRecordStatus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetRecordStatus).toHaveBeenCalledTimes(2);
    });

    it("should show missing record", async () => {
      mockGetRecordStatus.mockResolvedValueOnce(makeRecord({ found: false }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("MISSING");
    });
  });

  describe("onDidReceiveSettings", () => {
    it("should show setup when credentials removed", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should refetch on settings change", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ ...VALID_SETTINGS, recordType: "CNAME" }));
      expect(mockGetRecordStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up without error", () => { expect(() => action.onWillDisappear({} as any)).not.toThrow(); });

    it("should stop polling", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      action.onWillDisappear({} as any);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetRecordStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("onKeyDown", () => {
    it("should trigger manual refresh", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetRecordStatus.mockClear();
      mockGetRecordStatus.mockResolvedValueOnce(makeRecord({ content: "5.6.7.8" }));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(mockGetRecordStatus).toHaveBeenCalledTimes(1);
      expect(decodeSvg(keyEv.action.setImage.mock.calls[0][0])).toContain("5.6.7.8");
    });

    it("should do nothing when incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(mockGetRecordStatus).not.toHaveBeenCalled();
    });
  });

  describe("error back-off", () => {
    it("should keep cached display when refresh fails", async () => {
      mockGetRecordStatus.mockResolvedValueOnce(makeRecord());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetRecordStatus.mockRejectedValueOnce(new Error("Timeout"));
      await vi.advanceTimersByTimeAsync(60_000);
      // Should NOT show ERR — cached display is preserved
      const calls = ev.action.setImage.mock.calls;
      for (const call of calls) {
        expect(decodeSvg(call[0])).not.toContain("ERR");
      }
    });

    it("should show ERR only when no cache", async () => {
      mockGetRecordStatus.mockRejectedValueOnce(new Error("Fail"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("ERR");
    });
  });

  describe("marquee", () => {
    const LONG_SETTINGS = { ...VALID_SETTINGS, recordName: "subdomain.example.com" };

    it("should scroll for long names", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord({ name: "subdomain.example.com" }));
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(2000);
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(0);
    });

    it("should not scroll for short names", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord({ name: "e.com", content: "1.2.3" }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      // Advance past marquee start but before coordinator poll
      await vi.advanceTimersByTimeAsync(3000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop on disappear", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord({ name: "subdomain.example.com" }));
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      action.onWillDisappear(ev);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });
  });

  describe("global settings change", () => {
    it("should re-initialize when credentials change", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetRecordStatus.mockResolvedValueOnce(makeRecord({ content: "new-ip" }));
      await capturedGlobalListener!({ apiToken: "new-token" });
      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show setup when credentials removed", async () => {
      mockGetRecordStatus.mockResolvedValue(makeRecord());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      vi.mocked(getGlobalSettings).mockReturnValue({});
      await capturedGlobalListener!({});
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });
  });
});
