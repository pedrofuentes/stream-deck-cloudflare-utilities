/**
 * Cloudflare Worker Analytics type definitions.
 *
 * Types for the GraphQL workersInvocationsAdaptive analytics API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Metric types available for the Worker Analytics action.
 */
export type WorkerAnalyticsMetricType =
  | "requests"
  | "errors"
  | "error_rate"
  | "cpu_p50"
  | "cpu_p99"
  | "wall_time"
  | "subrequests";

/**
 * Aggregated worker analytics metrics returned from the GraphQL API.
 */
export interface WorkerAnalyticsMetrics {
  /** Total number of invocations */
  requests: number;
  /** Total number of errored invocations */
  errors: number;
  /** Total number of subrequests */
  subrequests: number;
  /** Total wall time in microseconds */
  wallTime: number;
  /** Median (p50) CPU time in microseconds */
  cpuTimeP50: number;
  /** P99 CPU time in microseconds */
  cpuTimeP99: number;
}

/**
 * Time range options for worker analytics.
 */
export type WorkerAnalyticsTimeRange = "24h" | "7d" | "30d";

/**
 * Settings for the Worker Analytics action.
 */
export type WorkerAnalyticsSettings = {
  /** Worker script name */
  workerName?: string;
  /** Currently displayed metric */
  metric?: WorkerAnalyticsMetricType;
  /** Time range for analytics */
  timeRange?: WorkerAnalyticsTimeRange;
};

/**
 * GraphQL response shape for workersInvocationsAdaptive.
 */
export interface WorkerAnalyticsGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: Array<{
          sum?: {
            requests?: number;
            errors?: number;
            subrequests?: number;
            wallTime?: number;
          };
          quantiles?: {
            cpuTimeP50?: number;
            cpuTimeP99?: number;
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
export const WORKER_METRIC_CYCLE_ORDER: WorkerAnalyticsMetricType[] = [
  "requests",
  "errors",
  "error_rate",
  "cpu_p50",
  "cpu_p99",
  "wall_time",
  "subrequests",
];

/**
 * Full labels for each metric (used in PI / tooltips).
 */
export const WORKER_METRIC_LABELS: Record<WorkerAnalyticsMetricType, string> = {
  requests: "Requests",
  errors: "Errors",
  error_rate: "Error Rate",
  cpu_p50: "CPU P50",
  cpu_p99: "CPU P99",
  wall_time: "Wall Time",
  subrequests: "Subrequests",
};

/**
 * Short labels for display on the key's line 3.
 */
export const WORKER_METRIC_SHORT_LABELS: Record<WorkerAnalyticsMetricType, string> = {
  requests: "reqs",
  errors: "errors",
  error_rate: "err rate",
  cpu_p50: "cpu p50",
  cpu_p99: "cpu p99",
  wall_time: "wall",
  subrequests: "subreqs",
};
