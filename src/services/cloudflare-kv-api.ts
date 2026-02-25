/**
 * Cloudflare Workers KV API client.
 *
 * GraphQL and REST client for querying KV namespace analytics.
 * Uses the kvOperationsAdaptiveGroups GraphQL dataset for operation counts
 * broken down by actionType.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  KvNamespace,
  KvNamespacesApiResponse,
  KvMetrics,
  KvTimeRange,
} from "../types/cloudflare-kv";
import { RateLimitError } from "./cloudflare-ai-gateway-api";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Client for interacting with the Cloudflare Workers KV API.
 */
export class CloudflareKvApi {
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
   * Fetches the list of KV namespaces for the account.
   */
  async listNamespaces(): Promise<KvNamespace[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/storage/kv/namespaces`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch KV namespaces: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as KvNamespacesApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Fetches KV analytics metrics via the GraphQL API.
   *
   * Uses the kvOperationsAdaptiveGroups dataset to get operation counts
   * broken down by actionType (read, write, delete, list).
   */
  async getAnalytics(
    namespaceId: string,
    timeRange: KvTimeRange
  ): Promise<KvMetrics> {
    const since = CloudflareKvApi.timeRangeToDate(timeRange);

    const query = `
      query KvAnalytics($accountTag: string!, $namespaceId: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            kvOperationsAdaptiveGroups(
              limit: 100
              filter: { date_geq: $since, namespaceId: $namespaceId }
            ) {
              dimensions {
                actionType
              }
              sum {
                requests
              }
            }
          }
        }
      }
    `;

    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: this.accountId,
          namespaceId,
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
        "getKvAnalytics",
        isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    if (!response.ok) {
      throw new Error(
        `KV analytics request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as KvAnalyticsGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups =
      data.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups ?? [];

    let readQueries = 0;
    let writeQueries = 0;
    let deleteQueries = 0;
    let listQueries = 0;

    for (const group of groups) {
      const actionType = group.dimensions?.actionType ?? "";
      const count = group.sum?.requests ?? 0;

      switch (actionType) {
        case "read":
          readQueries += count;
          break;
        case "write":
          writeQueries += count;
          break;
        case "delete":
          deleteQueries += count;
          break;
        case "list":
          listQueries += count;
          break;
      }
    }

    return { readQueries, writeQueries, deleteQueries, listQueries };
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  static timeRangeToDate(timeRange: KvTimeRange, now?: number): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}

/**
 * GraphQL response from kvOperationsAdaptiveGroups.
 */
interface KvAnalyticsGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        kvOperationsAdaptiveGroups?: Array<{
          dimensions?: { actionType?: string };
          sum?: { requests?: number };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}
