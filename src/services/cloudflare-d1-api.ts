/**
 * Cloudflare D1 Database API client.
 *
 * REST and GraphQL client for querying D1 database analytics.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  D1Database,
  D1DatabasesApiResponse,
  D1Metrics,
  D1AnalyticsGraphQLResponse,
  D1TimeRange,
} from "../types/cloudflare-d1";
import { RateLimitError } from "./cloudflare-ai-gateway-api";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Client for interacting with the Cloudflare D1 Database API.
 */
export class CloudflareD1Api {
  private baseUrl: string;
  private graphqlUrl: string;
  private apiToken: string;
  private accountId: string;

  constructor(apiToken: string, accountId: string, baseUrl?: string, graphqlUrl?: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.baseUrl = baseUrl ?? CLOUDFLARE_API_BASE;
    this.graphqlUrl = graphqlUrl ?? CLOUDFLARE_GRAPHQL;
  }

  /**
   * Fetches the list of D1 databases for the account.
   */
  async listDatabases(): Promise<D1Database[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch D1 databases: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as D1DatabasesApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetches D1 analytics metrics via GraphQL.
   */
  async getAnalytics(
    databaseId: string,
    timeRange: D1TimeRange
  ): Promise<D1Metrics> {
    const since = CloudflareD1Api.timeRangeToDate(timeRange);

    const query = `
      query D1Analytics($accountTag: string!, $dbId: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            d1AnalyticsAdaptiveGroups(
              filter: { databaseId: $dbId, date_geq: $since }
              limit: 1
            ) {
              sum {
                readQueries
                writeQueries
                rowsRead
                rowsWritten
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
          accountTag: this.accountId,
          dbId: databaseId,
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
        "getD1Analytics",
        isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as D1AnalyticsGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups =
      data.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;

    if (!groups || groups.length === 0) {
      return {
        readQueries: 0,
        writeQueries: 0,
        rowsRead: 0,
        rowsWritten: 0,
        databaseSizeBytes: 0,
      };
    }

    const group = groups[0];

    // Database size is not available in GraphQL; fetch from REST API.
    let databaseSizeBytes = 0;
    try {
      const db = await this.getDatabase(databaseId);
      databaseSizeBytes = db.file_size ?? 0;
    } catch {
      // Non-critical — db_size metric will show 0B.
    }

    return {
      readQueries: group.sum?.readQueries ?? 0,
      writeQueries: group.sum?.writeQueries ?? 0,
      rowsRead: group.sum?.rowsRead ?? 0,
      rowsWritten: group.sum?.rowsWritten ?? 0,
      databaseSizeBytes,
    };
  }

  /**
   * Fetches a single D1 database by ID (REST API).
   */
  async getDatabase(databaseId: string): Promise<D1Database> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/d1/database/${databaseId}`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch D1 database: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { success: boolean; errors?: Array<{ message: string }>; result: D1Database };
    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  static timeRangeToDate(timeRange: D1TimeRange, now?: number): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}
