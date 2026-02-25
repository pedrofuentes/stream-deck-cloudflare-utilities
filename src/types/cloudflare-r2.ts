/**
 * Cloudflare R2 Storage type definitions.
 *
 * Types for the R2 storage REST and GraphQL APIs.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Metric types available for the R2 Storage Metric action.
 */
export type R2MetricType =
  | "objects"
  | "storage"
  | "class_a_ops"
  | "class_b_ops";

/**
 * Aggregated R2 storage metrics.
 */
export interface R2Metrics {
  /** Total object count */
  objectCount: number;
  /** Total payload size in bytes */
  payloadSize: number;
  /** Total metadata size in bytes */
  metadataSize: number;
  /** Class A operations (writes) */
  classAOps: number;
  /** Class B operations (reads) */
  classBOps: number;
}

/**
 * Time range options for R2 analytics.
 */
export type R2TimeRange = "24h" | "7d" | "30d";

/**
 * Settings for the R2 Storage Metric action.
 */
export type R2MetricSettings = {
  /** R2 bucket name */
  bucketName?: string;
  /** Currently displayed metric */
  metric?: R2MetricType;
  /** Time range for analytics */
  timeRange?: R2TimeRange;
};

/**
 * R2 bucket from the list endpoint.
 */
export interface R2Bucket {
  /** Bucket name */
  name: string;
  /** ISO 8601 datetime */
  creation_date: string;
}

/**
 * API response for R2 buckets list.
 */
export interface R2BucketsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: {
    buckets: R2Bucket[];
  };
}

/**
 * GraphQL response shape for r2StorageAdaptiveGroups.
 */
export interface R2StorageGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2StorageAdaptiveGroups?: Array<{
          max?: {
            objectCount?: number;
            payloadSize?: number;
            metadataSize?: number;
          };
          dimensions?: {
            bucketName?: string;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * GraphQL response shape for r2OperationsAdaptiveGroups.
 */
export interface R2OperationsGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2OperationsAdaptiveGroups?: Array<{
          sum?: {
            requests?: number;
          };
          dimensions?: {
            actionType?: string;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Order in which metrics cycle on key press.
 */
export const R2_METRIC_CYCLE_ORDER: R2MetricType[] = [
  "objects",
  "storage",
  "class_a_ops",
  "class_b_ops",
];

/**
 * Full labels for each metric.
 */
export const R2_METRIC_LABELS: Record<R2MetricType, string> = {
  objects: "Objects",
  storage: "Storage",
  class_a_ops: "Class A Ops",
  class_b_ops: "Class B Ops",
};

/**
 * Short labels for display on the key's line 3.
 */
export const R2_METRIC_SHORT_LABELS: Record<R2MetricType, string> = {
  objects: "objects",
  storage: "storage",
  class_a_ops: "A ops",
  class_b_ops: "B ops",
};
