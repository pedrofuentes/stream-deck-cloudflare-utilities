/**
 * Tests for the Cloudflare DNS API client.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CloudflareDnsApi,
  resolveRecordName,
  truncateDomainName,
} from "../../src/services/cloudflare-dns-api";
import type { DnsRecord } from "../../src/types/cloudflare-dns";

// Mock the global fetch function
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockOkFetch(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockErrorFetch(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  });
}

function makeRecord(overrides?: Partial<DnsRecord>): DnsRecord {
  return {
    id: "rec-1",
    type: "A",
    name: "example.com",
    content: "1.2.3.4",
    proxied: true,
    proxiable: true,
    ttl: 1,
    zone_id: "zone-1",
    zone_name: "example.com",
    created_on: "2025-01-01T00:00:00Z",
    modified_on: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CloudflareDnsApi", () => {
  let client: CloudflareDnsApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CloudflareDnsApi("test-token", "https://mock-api.test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default base URL when none provided", () => {
      const defaultClient = new CloudflareDnsApi("token");
      expect(defaultClient).toBeDefined();
    });
  });

  // ── listZones ─────────────────────────────────────────────────────────

  describe("listZones", () => {
    it("should return sorted list of zones", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [
          { id: "z2", name: "beta.com", status: "active" },
          { id: "z1", name: "alpha.com", status: "active" },
        ],
      });

      const zones = await client.listZones();
      expect(zones).toHaveLength(2);
      expect(zones[0].name).toBe("alpha.com");
      expect(zones[1].name).toBe("beta.com");
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(401, "Unauthorized");
      await expect(client.listZones()).rejects.toThrow(
        "Failed to fetch zones: HTTP 401 Unauthorized"
      );
    });

    it("should throw on API error response", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 9103, message: "Unauthorized" }],
        messages: [],
        result: [],
      });
      await expect(client.listZones()).rejects.toThrow(
        "Cloudflare API error: Unauthorized"
      );
    });

    it("should throw on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(client.listZones()).rejects.toThrow("Connection refused");
    });

    it("should return empty array when no zones", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      const zones = await client.listZones();
      expect(zones).toHaveLength(0);
    });
  });

  // ── getRecords ────────────────────────────────────────────────────────

  describe("getRecords", () => {
    it("should return DNS records", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord()],
      });

      const records = await client.getRecords("zone-1");
      expect(records).toHaveLength(1);
      expect(records[0].content).toBe("1.2.3.4");
    });

    it("should filter by name and type", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      await client.getRecords("zone-1", "www.example.com", "CNAME");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("name=www.example.com"),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("type=CNAME"),
        expect.anything()
      );
    });

    it("should throw on HTTP error", async () => {
      mockErrorFetch(500, "Internal Server Error");
      await expect(client.getRecords("zone-1")).rejects.toThrow(
        "Failed to fetch DNS records: HTTP 500 Internal Server Error"
      );
    });

    it("should throw on API error", async () => {
      mockOkFetch({
        success: false,
        errors: [{ code: 1000, message: "Zone not found" }],
        messages: [],
        result: [],
      });
      await expect(client.getRecords("zone-bad")).rejects.toThrow(
        "Cloudflare API error: Zone not found"
      );
    });
  });

  // ── getRecordStatus ───────────────────────────────────────────────────

  describe("getRecordStatus", () => {
    it("should return found status for matching record", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord()],
      });

      const status = await client.getRecordStatus("zone-1", "example.com", "A");
      expect(status.found).toBe(true);
      expect(status.content).toBe("1.2.3.4");
      expect(status.proxied).toBe(true);
    });

    it("should return not-found status when no records match", async () => {
      mockOkFetch({ success: true, errors: [], messages: [], result: [] });
      const status = await client.getRecordStatus("zone-1", "missing.example.com", "A");
      expect(status.found).toBe(false);
      expect(status.content).toBe("");
    });

    it("should handle DNS-only records", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord({ proxied: false })],
      });
      const status = await client.getRecordStatus("zone-1", "example.com", "A");
      expect(status.proxied).toBe(false);
    });

    it("should resolve @ to zone name when zoneName is provided", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord()],
      });
      await client.getRecordStatus("zone-1", "@", "A", "example.com");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("name=example.com"),
        expect.anything()
      );
    });

    it("should resolve short subdomain to FQDN when zoneName is provided", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord({ name: "www.example.com" })],
      });
      await client.getRecordStatus("zone-1", "www", "A", "example.com");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("name=www.example.com"),
        expect.anything()
      );
    });

    it("should pass FQDN as-is even when zoneName is provided", async () => {
      mockOkFetch({
        success: true,
        errors: [],
        messages: [],
        result: [makeRecord()],
      });
      await client.getRecordStatus("zone-1", "example.com", "A", "example.com");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("name=example.com"),
        expect.anything()
      );
    });
  });
});

// ── resolveRecordName ──────────────────────────────────────────────────

describe("resolveRecordName", () => {
  it("should resolve @ to zone name", () => {
    expect(resolveRecordName("@", "example.com")).toBe("example.com");
  });

  it("should resolve @ with whitespace to zone name", () => {
    expect(resolveRecordName(" @ ", "example.com")).toBe("example.com");
  });

  it("should return @ as-is when zoneName is missing", () => {
    expect(resolveRecordName("@")).toBe("@");
  });

  it("should resolve short subdomain to FQDN", () => {
    expect(resolveRecordName("www", "example.com")).toBe("www.example.com");
  });

  it("should resolve multi-level subdomain without dots", () => {
    expect(resolveRecordName("api", "example.com")).toBe("api.example.com");
  });

  it("should return FQDN as-is", () => {
    expect(resolveRecordName("sub.example.com", "example.com")).toBe("sub.example.com");
  });

  it("should return FQDN as-is without zoneName", () => {
    expect(resolveRecordName("sub.example.com")).toBe("sub.example.com");
  });

  it("should return empty string as-is", () => {
    expect(resolveRecordName("")).toBe("");
  });

  it("should trim whitespace from record name", () => {
    expect(resolveRecordName("  www  ", "example.com")).toBe("www.example.com");
  });
});

// ── truncateDomainName ─────────────────────────────────────────────────

describe("truncateDomainName", () => {
  it("should return short names unchanged", () => {
    expect(truncateDomainName("test.com")).toBe("test.com");
  });

  it("should return exactly 10 chars unchanged", () => {
    expect(truncateDomainName("0123456789")).toBe("0123456789");
  });

  it("should truncate and add ellipsis for long names", () => {
    expect(truncateDomainName("very-long-domain.com")).toBe("very-long…");
  });

  it("should handle empty string", () => {
    expect(truncateDomainName("")).toBe("");
  });
});
