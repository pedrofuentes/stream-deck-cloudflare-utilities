/**
 * Cloudflare DNS API client.
 *
 * Fetches zones and DNS records from the Cloudflare API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  CloudflareZone,
  DnsRecord,
  ZonesApiResponse,
  DnsRecordsApiResponse,
} from "../types/cloudflare-dns";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Processed DNS record status for display on a Stream Deck key.
 */
export interface DnsRecordStatus {
  /** Record name (FQDN) */
  name: string;
  /** Record type (A, AAAA, CNAME, etc.) */
  type: string;
  /** Record content / value */
  content: string;
  /** Whether proxied through Cloudflare */
  proxied: boolean;
  /** TTL in seconds */
  ttl: number;
  /** Whether the record was found */
  found: boolean;
}

/**
 * Client for interacting with the Cloudflare DNS API.
 *
 * Requires a Cloudflare API Token with "Zone:Read" and "DNS:Read" permissions.
 */
export class CloudflareDnsApi {
  private baseUrl: string;
  private apiToken: string;

  constructor(apiToken: string, baseUrl?: string) {
    this.apiToken = apiToken;
    this.baseUrl = baseUrl ?? CLOUDFLARE_API_BASE;
  }

  /**
   * Fetches the list of zones accessible by the token.
   *
   * @returns Array of zones, sorted alphabetically by name
   * @throws {Error} If the API request fails
   */
  async listZones(): Promise<CloudflareZone[]> {
    const url = `${this.baseUrl}/zones?per_page=50&status=active`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch zones: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ZonesApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetches DNS records for a zone, optionally filtered by name and type.
   *
   * @param zoneId - Zone ID
   * @param recordName - Optional: filter by record name
   * @param recordType - Optional: filter by record type
   * @returns Array of matching DNS records
   * @throws {Error} If the API request fails
   */
  async getRecords(
    zoneId: string,
    recordName?: string,
    recordType?: string
  ): Promise<DnsRecord[]> {
    const params = new URLSearchParams();
    if (recordName) params.set("name", recordName);
    if (recordType) params.set("type", recordType);

    const url = `${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records?${params.toString()}`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch DNS records: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as DnsRecordsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result;
  }

  /**
   * Fetches a specific DNS record and returns a display-friendly status.
   *
   * @param zoneId - Zone ID
   * @param recordName - Record name to look up (can be "@", a subdomain, or FQDN)
   * @param recordType - Record type to filter
   * @param zoneName - Zone domain name, used to resolve "@" and short names to FQDN
   * @returns Processed record status
   * @throws {Error} If the API request fails
   */
  async getRecordStatus(
    zoneId: string,
    recordName: string,
    recordType?: string,
    zoneName?: string
  ): Promise<DnsRecordStatus> {
    const resolvedName = resolveRecordName(recordName, zoneName);
    const records = await this.getRecords(zoneId, resolvedName, recordType);

    if (records.length === 0) {
      return {
        name: recordName,
        type: recordType ?? "?",
        content: "",
        proxied: false,
        ttl: 0,
        found: false,
      };
    }

    const record = records[0];
    return {
      name: record.name,
      type: record.type,
      content: record.content,
      proxied: record.proxied,
      ttl: record.ttl,
      found: true,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }
}

/**
 * Truncates a domain name for display on a tiny OLED key.
 * Max 10 characters, appends "…" if truncated.
 */
export function truncateDomainName(name: string): string {
  if (name.length <= 10) return name;
  return name.slice(0, 9) + "…";
}

/**
 * Resolves shorthand record names to FQDNs for the Cloudflare API.
 *
 * The Cloudflare DNS API `name` filter requires the full domain name (FQDN),
 * but users commonly enter "@" (apex) or just a subdomain (e.g. "www").
 *
 * Resolution rules:
 * - "@" → zone name (e.g. "example.com")
 * - No dots and zoneName available → subdomain.zoneName (e.g. "www" → "www.example.com")
 * - Already an FQDN or no zoneName → returned as-is
 */
export function resolveRecordName(recordName: string, zoneName?: string): string {
  if (!recordName) return recordName;

  const trimmed = recordName.trim();

  // "@" is universal shorthand for the zone apex
  if (trimmed === "@" && zoneName) {
    return zoneName;
  }

  // If it has no dots and we know the zone, treat it as a subdomain
  if (!trimmed.includes(".") && zoneName && trimmed !== "@") {
    return `${trimmed}.${zoneName}`;
  }

  return trimmed;
}
