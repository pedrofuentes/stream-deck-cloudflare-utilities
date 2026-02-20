/**
 * Types for the Cloudflare AI Gateway API.
 *
 * @see https://developers.cloudflare.com/api/resources/ai_gateway/
 */

/**
 * Settings for the AI Gateway Metric action (per-button).
 * Auth credentials (apiToken, accountId) are in global settings.
 */
export type AiGatewayMetricSettings = {
  /** ID of the AI Gateway to monitor */
  gatewayId?: string;
  /** Which metric to display on the key */
  metric?: AiGatewayMetricType;
  /** Time range for GraphQL-based metrics */
  timeRange?: AiGatewayTimeRange;
  /** Refresh interval in seconds (default: 60) */
  refreshIntervalSeconds?: number;
};

/**
 * The metrics available on the Stream Deck key.
 */
export type AiGatewayMetricType =
  | "requests"
  | "tokens"
  | "cost"
  | "errors"
  | "logs_stored";

/**
 * Time range filter for analytics queries.
 */
export type AiGatewayTimeRange = "24h" | "7d" | "30d";

/**
 * Minimal representation of an AI Gateway from the list endpoint.
 */
export interface AiGateway {
  /** Gateway slug/ID */
  id: string;
  /** Account ID */
  account_id: string;
  /** Account tag */
  account_tag: string;
  /** Human-readable name (may be same as id) */
  name: string;
  /** ISO 8601 datetime when the gateway was created */
  created_at: string;
  /** ISO 8601 datetime when the gateway was last modified */
  modified_at: string;
}

/**
 * API response shape from GET /accounts/{account_id}/ai-gateway/gateways
 */
export interface AiGatewayListResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: AiGateway[];
}

/**
 * API response shape from GET /accounts/{account_id}/ai-gateway/gateways/{id}/logs
 * with meta_info=true and per_page=1
 */
export interface AiGatewayLogsResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: unknown[];
  result_info?: {
    /** Total number of logs stored */
    total_count: number;
    count: number;
    page: number;
    per_page: number;
  };
}

/**
 * GraphQL response for AI Gateway analytics.
 */
export interface AiGatewayGraphQLResponse {
  data: {
    viewer: {
      accounts: Array<{
        aiGatewayRequestsAdaptiveGroups: Array<{
          /** Total number of requests (group-level count) */
          count: number;
          sum: {
            /** Total estimated cost in USD */
            cost: number;
            /** Total number of errored requests */
            erroredRequests: number;
            /** Cached input tokens */
            cachedTokensIn: number;
            /** Cached output tokens */
            cachedTokensOut: number;
            /** Uncached input tokens */
            uncachedTokensIn: number;
            /** Uncached output tokens */
            uncachedTokensOut: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Processed metrics from the AI Gateway for display.
 */
export interface AiGatewayMetrics {
  /** Total requests */
  requests: number;
  /** Total tokens (in + out) */
  tokens: number;
  /** Tokens in */
  tokensIn: number;
  /** Tokens out */
  tokensOut: number;
  /** Estimated cost in USD */
  cost: number;
  /** Error count */
  errors: number;
  /** Logs stored in the gateway */
  logsStored: number;
}

/**
 * All available metric types in order for cycling.
 */
export const METRIC_CYCLE_ORDER: AiGatewayMetricType[] = [
  "requests",
  "tokens",
  "cost",
  "errors",
  "logs_stored",
];

/**
 * Human-readable labels for each metric type.
 */
export const METRIC_LABELS: Record<AiGatewayMetricType, string> = {
  requests: "Requests",
  tokens: "Tokens",
  cost: "Cost",
  errors: "Errors",
  logs_stored: "Logs",
};

/**
 * Short labels for line3 on the key (with time range).
 */
export const METRIC_SHORT_LABELS: Record<AiGatewayMetricType, string> = {
  requests: "reqs",
  tokens: "tokens",
  cost: "cost",
  errors: "errors",
  logs_stored: "stored",
};
