/**
 * Cloudflare AI Gateway API client.
 *
 * GraphQL and REST client for querying AI Gateway metrics,
 * listing gateways, and retrieving log counts.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  AiGateway,
  AiGatewayListResponse,
  AiGatewayLogsResponse,
  AiGatewayGraphQLResponse,
  AiGatewayMetrics,
  AiGatewayTimeRange,
} from "../types/cloudflare-ai-gateway";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Error thrown when the Cloudflare API returns HTTP 429 (Too Many Requests).
 * Contains the retry-after delay so callers can back off appropriately.
 */
export class RateLimitError extends Error {
  /** Suggested retry delay in seconds (from Retry-After header, or default 60). */
  readonly retryAfterSeconds: number;

  constructor(endpoint: string, retryAfter?: number) {
    const delay = retryAfter ?? 60;
    super(`Rate limited on ${endpoint} (retry after ${delay}s)`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = delay;
  }
}

/**
 * Client for interacting with the Cloudflare AI Gateway API.
 *
 * Uses REST for listing gateways and log counts,
 * and GraphQL for aggregated analytics (requests, tokens, cost, errors).
 *
 * @see https://developers.cloudflare.com/api/resources/ai_gateway/
 */
export class CloudflareAiGatewayApi {
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
   * Fetches the list of AI Gateways for the account.
   *
   * @returns Array of gateways sorted alphabetically by name
   * @throws {Error} If the API request fails
   */
  async listGateways(): Promise<AiGateway[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/ai-gateway/gateways`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch gateways: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as AiGatewayListResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Fetches the total log count for a gateway.
   *
   * Uses the logs list endpoint with meta_info=true and per_page=1
   * to get just the count without fetching actual log data.
   *
   * @param gatewayId - Gateway ID
   * @returns Total number of logs stored
   * @throws {Error} If the API request fails
   */
  async getLogsCount(gatewayId: string): Promise<number> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/ai-gateway/gateways/${encodeURIComponent(gatewayId)}/logs?per_page=1&meta_info=true`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "", 10);
      throw new RateLimitError("getLogsCount", isNaN(retryAfter) ? undefined : retryAfter);
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch log count: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as AiGatewayLogsResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result_info?.total_count ?? 0;
  }

  /**
   * Fetches aggregated analytics for a gateway using the GraphQL API.
   *
   * Returns total requests, tokens (in/out), estimated cost, and error count
   * for the given time range.
   *
   * @param gatewayId - Gateway ID
   * @param timeRange - Time range filter ("24h", "7d", "30d")
   * @returns Aggregated analytics metrics
   * @throws {Error} If the GraphQL request fails
   */
  async getAnalytics(gatewayId: string, timeRange: AiGatewayTimeRange): Promise<{
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    errors: number;
  }> {
    const since = CloudflareAiGatewayApi.timeRangeToDate(timeRange);

    const query = `
      query AiGatewayAnalytics($accountTag: string!, $gateway: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            aiGatewayRequestsAdaptiveGroups(
              filter: { gateway: $gateway, date_geq: $since }
              limit: 1
            ) {
              count
              sum {
                cost
                erroredRequests
                cachedTokensIn
                cachedTokensOut
                uncachedTokensIn
                uncachedTokensOut
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
          gateway: gatewayId,
          since: since.toISOString().split("T")[0],
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "", 10);
      throw new RateLimitError("getAnalytics", isNaN(retryAfter) ? undefined : retryAfter);
    }

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as AiGatewayGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups = data.data?.viewer?.accounts?.[0]?.aiGatewayRequestsAdaptiveGroups;

    if (!groups || groups.length === 0) {
      return { requests: 0, tokensIn: 0, tokensOut: 0, cost: 0, errors: 0 };
    }

    const group = groups[0];
    const sum = group.sum;
    return {
      requests: group.count ?? 0,
      tokensIn: (sum.cachedTokensIn ?? 0) + (sum.uncachedTokensIn ?? 0),
      tokensOut: (sum.cachedTokensOut ?? 0) + (sum.uncachedTokensOut ?? 0),
      cost: sum.cost ?? 0,
      errors: sum.erroredRequests ?? 0,
    };
  }

  /**
   * Fetches all metrics for a gateway (combines REST + GraphQL).
   *
   * @param gatewayId - Gateway ID
   * @param timeRange - Time range for analytics ("24h", "7d", "30d")
   * @returns Complete metrics object
   * @throws {Error} If any API request fails
   */
  async getMetrics(gatewayId: string, timeRange: AiGatewayTimeRange): Promise<AiGatewayMetrics> {
    const [analytics, logsStored] = await Promise.all([
      this.getAnalytics(gatewayId, timeRange),
      this.getLogsCount(gatewayId),
    ]);

    return {
      requests: analytics.requests,
      tokens: analytics.tokensIn + analytics.tokensOut,
      tokensIn: analytics.tokensIn,
      tokensOut: analytics.tokensOut,
      cost: analytics.cost,
      errors: analytics.errors,
      logsStored,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Converts a time range to a Date object representing the start of the range.
   */
  static timeRangeToDate(timeRange: AiGatewayTimeRange, now?: number): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}

/**
 * Formats a number for compact display on a Stream Deck key.
 *
 * Examples: 0 → "0", 42 → "42", 1234 → "1.2K", 1234567 → "1.2M"
 */
export function formatCompactNumber(value: number): string {
  if (value < 0) {
    return `-${formatCompactNumber(-value)}`;
  }
  if (value < 1000) {
    return Math.round(value).toString();
  }
  if (value < 1_000_000) {
    const k = value / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  if (value < 1_000_000_000) {
    const m = value / 1_000_000;
    return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  const b = value / 1_000_000_000;
  return b >= 100 ? `${Math.round(b)}B` : `${b.toFixed(1).replace(/\.0$/, "")}B`;
}

/**
 * Formats a cost value for display on a Stream Deck key.
 *
 * Examples: 0 → "$0", 0.05 → "$0.05", 4.523 → "$4.52", 1234 → "$1.2K"
 */
export function formatCost(value: number): string {
  if (value < 0) {
    return `-${formatCost(-value)}`;
  }
  if (value < 0.01) {
    return "$0";
  }
  if (value < 1000) {
    return `$${value.toFixed(2).replace(/\.00$/, "")}`;
  }
  return `$${formatCompactNumber(value)}`;
}
