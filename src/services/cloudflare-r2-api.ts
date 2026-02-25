/**
 * Cloudflare R2 Storage API client.
 *
 * REST and GraphQL client for querying R2 bucket storage metrics.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  R2Bucket,
  R2BucketsApiResponse,
  R2Metrics,
  R2StorageGraphQLResponse,
  R2OperationsGraphQLResponse,
  R2TimeRange,
} from "../types/cloudflare-r2";
import { RateLimitError } from "./cloudflare-ai-gateway-api";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Client for interacting with the Cloudflare R2 Storage API.
 */
export class CloudflareR2Api {
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
   * Fetches the list of R2 buckets for the account.
   */
  async listBuckets(): Promise<R2Bucket[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/r2/buckets`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch R2 buckets: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as R2BucketsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return (data.result.buckets ?? []).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetches R2 storage and operations metrics via GraphQL.
   */
  async getMetrics(
    bucketName: string,
    timeRange: R2TimeRange
  ): Promise<R2Metrics> {
    const since = CloudflareR2Api.timeRangeToDate(timeRange);

    // Fetch storage and operations in parallel
    const [storage, operations] = await Promise.all([
      this.fetchStorage(bucketName, since),
      this.fetchOperations(bucketName, since),
    ]);

    return {
      objectCount: storage.objectCount,
      payloadSize: storage.payloadSize,
      metadataSize: storage.metadataSize,
      classAOps: operations.classA,
      classBOps: operations.classB,
    };
  }

  private async fetchStorage(
    bucketName: string,
    since: Date
  ): Promise<{ objectCount: number; payloadSize: number; metadataSize: number }> {
    const query = `
      query R2Storage($accountTag: string!, $bucket: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            r2StorageAdaptiveGroups(
              filter: { bucketName: $bucket, date_geq: $since }
              limit: 1
            ) {
              max {
                objectCount
                payloadSize
                metadataSize
              }
            }
          }
        }
      }
    `;

    const response = await this.executeGraphQL(query, {
      accountTag: this.accountId,
      bucket: bucketName,
      since: since.toISOString().split("T")[0],
    });

    const data = response as R2StorageGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups = data.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
    if (!groups || groups.length === 0) {
      return { objectCount: 0, payloadSize: 0, metadataSize: 0 };
    }

    const max = groups[0].max;
    return {
      objectCount: max?.objectCount ?? 0,
      payloadSize: max?.payloadSize ?? 0,
      metadataSize: max?.metadataSize ?? 0,
    };
  }

  private async fetchOperations(
    bucketName: string,
    since: Date
  ): Promise<{ classA: number; classB: number }> {
    const query = `
      query R2Operations($accountTag: string!, $bucket: string!, $since: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            r2OperationsAdaptiveGroups(
              filter: { bucketName: $bucket, date_geq: $since }
              limit: 10
            ) {
              sum {
                requests
              }
              dimensions {
                actionType
              }
            }
          }
        }
      }
    `;

    const response = await this.executeGraphQL(query, {
      accountTag: this.accountId,
      bucket: bucketName,
      since: since.toISOString().split("T")[0],
    });

    const data = response as R2OperationsGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`);
    }

    const groups = data.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups;
    if (!groups || groups.length === 0) {
      return { classA: 0, classB: 0 };
    }

    let classA = 0;
    let classB = 0;

    for (const group of groups) {
      const actionType = group.dimensions?.actionType ?? "";
      const count = group.sum?.requests ?? 0;
      // Class A: PutObject, DeleteObject, ListBucket, etc.
      // Class B: GetObject, HeadObject
      if (["GetObject", "HeadObject"].includes(actionType)) {
        classB += count;
      } else {
        classA += count;
      }
    }

    return { classA, classB };
  }

  private async executeGraphQL(query: string, variables: Record<string, string>): Promise<unknown> {
    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get("Retry-After") ?? "",
        10
      );
      throw new RateLimitError(
        "R2 GraphQL",
        isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    if (!response.ok) {
      throw new Error(
        `GraphQL request failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  static timeRangeToDate(timeRange: R2TimeRange, now?: number): Date {
    const current = now ?? Date.now();
    const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 168 : 720;
    return new Date(current - hours * 60 * 60 * 1000);
  }
}
