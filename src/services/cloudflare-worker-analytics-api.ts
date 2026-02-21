/**
 * Cloudflare Worker Analytics API client.
 *
 * GraphQL client for querying Worker invocation analytics using the
 * workersInvocationsAdaptive dataset.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  WorkerAnalyticsGraphQLResponse,
  WorkerAnalyticsMetrics,
  WorkerAnalyticsTimeRange,
} from "../types/cloudflare-worker-analytics";
import { RateLimitError } from "./cloudflare-ai-gateway-api";

const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Client for fetching Worker analytics from the Cloudflare GraphQL API.
 *
 * Uses the `workersInvocationsAdaptive` dataset to retrieve aggregated
 * invocation stats for a Worker script.
 */
export class CloudflareWorkerAnalyticsApi {
  private graphqlUrl: string;
  private apiToken: string;
  private accountId: string;

  constructor(apiToken: string, accountId: string, graphqlUrl?: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.graphqlUrl = graphqlUrl ?? CLOUDFLARE_GRAPHQL;
  }

  /**
   * Fetches aggregated analytics for a Worker script.
   *
   * @param scriptName - Worker script name
   * @param timeRange - Time range filter ("24h", "7d", "30d")
   * @returns Aggregated analytics metrics
   * @throws {Error} If the GraphQL request fails
   * @throws {RateLimitError} If rate limited (HTTP 429)
   */
  async getAnalytics(
    scriptName: string,
    timeRange: WorkerAnalyticsTimeRange
  ): Promise<WorkerAnalyticsMetrics> {
    const since = CloudflareWorkerAnalyticsApi.timeRangeToDate(timeRange);

    const query = `
      query WorkerAnalytics($accountTag: string!, $scriptName: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            workersInvocationsAdaptive(
              filter: { scriptName: $scriptName, date_geq: $since }
              limit: 10000
            ) {
              sum {
                requests
                errors
                subrequests
                wallTime
              }
              quantiles {
                cpuTimeP50
                cpuTimeP99
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
          scriptName,
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
        "getWorkerAnalytics",
        isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as WorkerAnalyticsGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups =
      data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;

    if (!groups || groups.length === 0) {
      return {
        requests: 0,
        errors: 0,
        subrequests: 0,
        wallTime: 0,
        cpuTimeP50: 0,
        cpuTimeP99: 0,
      };
    }

    // Aggregate across all groups (adaptive sampling may return multiple)
    let totalRequests = 0;
    let totalErrors = 0;
    let totalSubrequests = 0;
    let totalWallTime = 0;
    let cpuP50 = 0;
    let cpuP99 = 0;

    for (const group of groups) {
      totalRequests += group.sum?.requests ?? 0;
      totalErrors += group.sum?.errors ?? 0;
      totalSubrequests += group.sum?.subrequests ?? 0;
      totalWallTime += group.sum?.wallTime ?? 0;
      // For quantiles, take the max across groups (worst case)
      cpuP50 = Math.max(cpuP50, group.quantiles?.cpuTimeP50 ?? 0);
      cpuP99 = Math.max(cpuP99, group.quantiles?.cpuTimeP99 ?? 0);
    }

    return {
      requests: totalRequests,
      errors: totalErrors,
      subrequests: totalSubrequests,
      wallTime: totalWallTime,
      cpuTimeP50: cpuP50,
      cpuTimeP99: cpuP99,
    };
  }

  /**
   * Converts a time range to a Date object representing the start of the range.
   */
  static timeRangeToDate(
    timeRange: WorkerAnalyticsTimeRange,
    now?: number
  ): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}

/**
 * Formats a duration in microseconds to a compact display string.
 *
 * @param microseconds - Duration in microseconds
 * @returns Compact string, e.g. "2.3ms", "150μs", "1.2s"
 */
export function formatDuration(microseconds: number): string {
  if (microseconds < 0) {
    return `-${formatDuration(-microseconds)}`;
  }
  if (microseconds === 0) {
    return "0ms";
  }
  if (microseconds < 1000) {
    return `${Math.round(microseconds)}μs`;
  }
  const ms = microseconds / 1000;
  if (ms < 1000) {
    return ms >= 100
      ? `${Math.round(ms)}ms`
      : `${ms.toFixed(1).replace(/\.0$/, "")}ms`;
  }
  const s = ms / 1000;
  return s >= 100
    ? `${Math.round(s)}s`
    : `${s.toFixed(1).replace(/\.0$/, "")}s`;
}
