/**
 * Represents the overall system status from Cloudflare's status page.
 */
export interface CloudflareSystemStatus {
  /** Status indicator: "none" | "minor" | "major" | "critical" */
  indicator: string;
  /** Human-readable description of the status */
  description: string;
}

/**
 * Represents a single component from the Cloudflare status page.
 */
export interface CloudflareComponent {
  /** Component identifier */
  id: string;
  /** Component name */
  name: string;
  /** Component status: "operational" | "degraded_performance" | "partial_outage" | "major_outage" */
  status: string;
  /** Human-readable description */
  description: string | null;
}

/**
 * Response shape from the Cloudflare status API summary endpoint.
 */
export interface CloudflareStatusApiResponse {
  page: {
    id: string;
    name: string;
    url: string;
  };
  status: {
    indicator: string;
    description: string;
  };
  components: Array<{
    id: string;
    name: string;
    status: string;
    description: string | null;
  }>;
}
