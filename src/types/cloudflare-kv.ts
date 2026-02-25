/**
 * Cloudflare Workers KV type definitions.
 *
 * Types for the KV analytics GraphQL API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Metric types available for the KV Namespace Metric action.
 */
export type KvMetricType =
  | "reads"
  | "writes"
  | "deletes"
  | "lists";

/**
 * Aggregated KV namespace metrics.
 */
export interface KvMetrics {
  /** Total read operations */
  readQueries: number;
  /** Total write operations */
  writeQueries: number;
  /** Total delete operations */
  deleteQueries: number;
  /** Total list operations */
  listQueries: number;
}

/**
 * Time range options for KV analytics.
 */
export type KvTimeRange = "24h" | "7d" | "30d";

/**
 * Settings for the KV Namespace Metric action.
 */
export type KvMetricSettings = {
  /** KV namespace ID */
  namespaceId?: string;
  /** KV namespace title (for display) */
  namespaceName?: string;
  /** Currently displayed metric */
  metric?: KvMetricType;
  /** Time range for analytics */
  timeRange?: KvTimeRange;
};

/**
 * A KV namespace from the list endpoint.
 */
export interface KvNamespace {
  /** Namespace UUID */
  id: string;
  /** Namespace title */
  title: string;
  /** Whether supports URL encoding */
  supports_url_encoding: boolean;
}

/**
 * API response for KV namespaces list.
 */
export interface KvNamespacesApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: KvNamespace[];
}

/**
 * Order in which metrics cycle on key press.
 */
export const KV_METRIC_CYCLE_ORDER: KvMetricType[] = [
  "reads",
  "writes",
  "deletes",
  "lists",
];

/**
 * Full labels for each metric.
 */
export const KV_METRIC_LABELS: Record<KvMetricType, string> = {
  reads: "Reads",
  writes: "Writes",
  deletes: "Deletes",
  lists: "Lists",
};

/**
 * Short labels for display on the key's line 3.
 */
export const KV_METRIC_SHORT_LABELS: Record<KvMetricType, string> = {
  reads: "reads",
  writes: "writes",
  deletes: "deletes",
  lists: "lists",
};
