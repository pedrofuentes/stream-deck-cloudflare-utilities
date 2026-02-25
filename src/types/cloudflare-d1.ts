/**
 * Cloudflare D1 Database type definitions.
 *
 * Types for the D1 analytics GraphQL API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Metric types available for the D1 Database Metric action.
 */
export type D1MetricType =
  | "reads"
  | "writes"
  | "rows_read"
  | "rows_written"
  | "db_size";

/**
 * Aggregated D1 database metrics.
 */
export interface D1Metrics {
  /** Total read queries */
  readQueries: number;
  /** Total write queries */
  writeQueries: number;
  /** Total rows read */
  rowsRead: number;
  /** Total rows written */
  rowsWritten: number;
  /** Database size in bytes */
  databaseSizeBytes: number;
}

/**
 * Time range options for D1 analytics.
 */
export type D1TimeRange = "24h" | "7d" | "30d";

/**
 * Settings for the D1 Database Metric action.
 */
export type D1MetricSettings = {
  /** D1 database UUID */
  databaseId?: string;
  /** Human-readable database name (saved by the PI) */
  databaseName?: string;
  /** Currently displayed metric */
  metric?: D1MetricType;
  /** Time range for analytics */
  timeRange?: D1TimeRange;
};

/**
 * A D1 database from the list endpoint.
 */
export interface D1Database {
  /** Database UUID */
  uuid: string;
  /** Database name */
  name: string;
  /** Version tag */
  version: string;
  /** Number of tables */
  num_tables: number;
  /** File size in bytes */
  file_size: number;
  /** ISO 8601 datetime */
  created_at: string;
}

/**
 * API response for D1 databases list.
 */
export interface D1DatabasesApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: D1Database[];
}

/**
 * GraphQL response shape for d1AnalyticsAdaptiveGroups.
 */
export interface D1AnalyticsGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        d1AnalyticsAdaptiveGroups?: Array<{
          sum?: {
            readQueries?: number;
            writeQueries?: number;
            rowsRead?: number;
            rowsWritten?: number;
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
export const D1_METRIC_CYCLE_ORDER: D1MetricType[] = [
  "reads",
  "writes",
  "rows_read",
  "rows_written",
  "db_size",
];

/**
 * Full labels for each metric.
 */
export const D1_METRIC_LABELS: Record<D1MetricType, string> = {
  reads: "Read Queries",
  writes: "Write Queries",
  rows_read: "Rows Read",
  rows_written: "Rows Written",
  db_size: "DB Size",
};

/**
 * Short labels for display on the key's line 3.
 */
export const D1_METRIC_SHORT_LABELS: Record<D1MetricType, string> = {
  reads: "reads",
  writes: "writes",
  rows_read: "rows rd",
  rows_written: "rows wr",
  db_size: "size",
};
