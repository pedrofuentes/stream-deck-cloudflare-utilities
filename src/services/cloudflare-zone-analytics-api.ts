/**
 * Cloudflare Zone Analytics API client.
 *
 * GraphQL client for querying zone-level HTTP analytics using the
 * httpRequests1dGroups dataset.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  ZoneAnalyticsGraphQLResponse,
  ZoneAnalyticsMetrics,
  ZoneAnalyticsTimeRange,
} from "../types/cloudflare-zone-analytics";
import { RateLimitError } from "./cloudflare-ai-gateway-api";

const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Client for fetching zone analytics from the Cloudflare GraphQL API.
 *
 * Uses the `httpRequests1dGroups` dataset to retrieve aggregated
 * HTTP request stats for a zone.
 */
export class CloudflareZoneAnalyticsApi {
  private graphqlUrl: string;
  private apiToken: string;

  constructor(apiToken: string, graphqlUrl?: string) {
    this.apiToken = apiToken;
    this.graphqlUrl = graphqlUrl ?? CLOUDFLARE_GRAPHQL;
  }

  /**
   * Fetches aggregated analytics for a zone.
   *
   * @param zoneTag - Zone ID
   * @param timeRange - Time range filter ("24h", "7d", "30d")
   * @returns Aggregated analytics metrics
   * @throws {Error} If the GraphQL request fails
   * @throws {RateLimitError} If rate limited (HTTP 429)
   */
  async getAnalytics(
    zoneTag: string,
    timeRange: ZoneAnalyticsTimeRange
  ): Promise<ZoneAnalyticsMetrics> {
    const since = CloudflareZoneAnalyticsApi.timeRangeToDate(timeRange);

    const query = `
      query ZoneAnalytics($zoneTag: string!, $since: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1dGroups(
              filter: { date_geq: $since }
              limit: 10000
            ) {
              sum {
                requests
                bytes
                cachedBytes
                threats
              }
              uniq {
                uniques
              }
            }
          }
        }
      }
    `;

    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          zoneTag,
          since: since.toISOString().split("T")[0],
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get("Retry-After") ?? "",
        10
      );
      throw new RateLimitError(
        "getZoneAnalytics",
        isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ZoneAnalyticsGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups = data.data?.viewer?.zones?.[0]?.httpRequests1dGroups;

    if (!groups || groups.length === 0) {
      return {
        requests: 0,
        bandwidth: 0,
        cachedBytes: 0,
        threats: 0,
        visitors: 0,
      };
    }

    // Aggregate across all day-groups in the range
    let requests = 0;
    let bandwidth = 0;
    let cachedBytes = 0;
    let threats = 0;
    let visitors = 0;
    for (const group of groups) {
      requests += group.sum?.requests ?? 0;
      bandwidth += group.sum?.bytes ?? 0;
      cachedBytes += group.sum?.cachedBytes ?? 0;
      threats += group.sum?.threats ?? 0;
      visitors += group.uniq?.uniques ?? 0;
    }
    return { requests, bandwidth, cachedBytes, threats, visitors };
  }

  /**
   * Converts a time range to a Date object representing the start of the range.
   */
  static timeRangeToDate(
    timeRange: ZoneAnalyticsTimeRange,
    now?: number
  ): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}

/**
 * Formats bytes into a compact human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Compact string, e.g. "4.5KB", "1.2MB", "3.1GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return `-${formatBytes(-bytes)}`;
  if (bytes === 0) return "0B";
  if (bytes < 1024) return `${Math.round(bytes)}B`;

  const kb = bytes / 1024;
  if (kb < 1024) {
    return kb >= 100 ? `${Math.round(kb)}KB` : `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  }

  const gb = mb / 1024;
  if (gb < 1024) {
    return gb >= 100 ? `${Math.round(gb)}GB` : `${gb.toFixed(1).replace(/\.0$/, "")}GB`;
  }

  const tb = gb / 1024;
  return tb >= 100 ? `${Math.round(tb)}TB` : `${tb.toFixed(1).replace(/\.0$/, "")}TB`;
}
