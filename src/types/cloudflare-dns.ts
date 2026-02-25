/**
 * Cloudflare DNS record types.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Settings for the DNS Record Monitor action.
 */
export type DnsRecordSettings = {
  /** Zone ID to query */
  zoneId?: string;
  /** Zone name / domain (e.g. "example.com") — saved alongside zoneId */
  zoneName?: string;
  /** DNS record name (e.g. "@", "www", or FQDN) */
  recordName?: string;
  /** DNS record type filter (e.g. "A", "AAAA", "CNAME") */
  recordType?: string;
};

/**
 * A DNS record from the Cloudflare API.
 */
export interface DnsRecord {
  /** Record UUID */
  id: string;
  /** Zone ID */
  zone_id: string;
  /** Zone name */
  zone_name: string;
  /** Record name (FQDN) */
  name: string;
  /** Record type: A, AAAA, CNAME, TXT, MX, etc. */
  type: string;
  /** Record content / value */
  content: string;
  /** Whether proxied through Cloudflare */
  proxied: boolean;
  /** Whether the record is proxiable */
  proxiable: boolean;
  /** TTL in seconds (1 = automatic) */
  ttl: number;
  /** ISO 8601 datetime */
  created_on: string;
  /** ISO 8601 datetime */
  modified_on: string;
}

/**
 * A zone from the Cloudflare API.
 */
export interface CloudflareZone {
  /** Zone UUID */
  id: string;
  /** Zone name (domain) */
  name: string;
  /** Zone status: "active" | "pending" | etc. */
  status: string;
}

/**
 * API response for zones list.
 */
export interface ZonesApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: CloudflareZone[];
}

/**
 * API response for DNS records list.
 */
export interface DnsRecordsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: DnsRecord[];
}
