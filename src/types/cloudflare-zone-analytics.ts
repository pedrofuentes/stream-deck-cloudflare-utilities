/**
 * Cloudflare Zone Analytics type definitions.
 *
 * Types for the GraphQL httpRequests1dGroups analytics API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Metric types available for the Zone Analytics action.
 */
export type ZoneAnalyticsMetricType =
  | "requests"
  | "bandwidth"
  | "cache_rate"
  | "threats"
  | "visitors";

/**
 * Aggregated zone analytics metrics.
 */
export interface ZoneAnalyticsMetrics {
  /** Total HTTP requests */
  requests: number;
  /** Total bandwidth in bytes */
  bandwidth: number;
  /** Cached bytes */
  cachedBytes: number;
  /** Threats blocked */
  threats: number;
  /** Unique visitors */
  visitors: number;
}

/**
 * Time range options for zone analytics.
 */
export type ZoneAnalyticsTimeRange = "24h" | "7d" | "30d";

/**
 * Settings for the Zone Analytics action.
 */
export type ZoneAnalyticsSettings = {
  /** Zone ID to query */
  zoneId?: string;
  /** Human-readable zone name (saved by the PI) */
  zoneName?: string;
  /** Currently displayed metric */
  metric?: ZoneAnalyticsMetricType;
  /** Time range for analytics */
  timeRange?: ZoneAnalyticsTimeRange;
};

/**
 * GraphQL response shape for httpRequests1dGroups.
 */
export interface ZoneAnalyticsGraphQLResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        httpRequests1dGroups?: Array<{
          sum?: {
            requests?: number;
            bytes?: number;
            cachedBytes?: number;
            threats?: number;
          };
          uniq?: {
            uniques?: number;
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
export const ZONE_METRIC_CYCLE_ORDER: ZoneAnalyticsMetricType[] = [
  "requests",
  "bandwidth",
  "cache_rate",
  "threats",
  "visitors",
];

/**
 * Full labels for each metric.
 */
export const ZONE_METRIC_LABELS: Record<ZoneAnalyticsMetricType, string> = {
  requests: "Requests",
  bandwidth: "Bandwidth",
  cache_rate: "Cache Rate",
  threats: "Threats",
  visitors: "Visitors",
};

/**
 * Short labels for display on the key's line 3.
 */
export const ZONE_METRIC_SHORT_LABELS: Record<ZoneAnalyticsMetricType, string> = {
  requests: "reqs",
  bandwidth: "bw",
  cache_rate: "cache",
  threats: "threats",
  visitors: "visitors",
};
