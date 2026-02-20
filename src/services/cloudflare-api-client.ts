import type {
  CloudflareSystemStatus,
  CloudflareComponent,
  CloudflareStatusApiResponse,
} from "../types/cloudflare";

const CLOUDFLARE_STATUS_API = "https://www.cloudflarestatus.com/api/v2";

/**
 * Client for interacting with the Cloudflare Status API.
 *
 * Uses the public Cloudflare status page API (Atlassian Statuspage format).
 * No authentication is required for this endpoint.
 *
 * @see https://www.cloudflarestatus.com/api/v2
 */
export class CloudflareApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? CLOUDFLARE_STATUS_API;
  }

  /**
   * Fetches the current overall Cloudflare system status.
   *
   * @returns The system status with indicator and description.
   * @throws {Error} If the API request fails or returns an unexpected response.
   */
  async getSystemStatus(): Promise<CloudflareSystemStatus> {
    const response = await fetch(`${this.baseUrl}/status.json`);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Cloudflare status: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as CloudflareStatusApiResponse;

    return {
      indicator: data.status.indicator,
      description: data.status.description,
    };
  }

  /**
   * Fetches the status of individual Cloudflare components.
   *
   * @returns Array of component statuses.
   * @throws {Error} If the API request fails or returns an unexpected response.
   */
  async getComponents(): Promise<CloudflareComponent[]> {
    const response = await fetch(`${this.baseUrl}/components.json`);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Cloudflare components: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { components: CloudflareComponent[] };

    return data.components.map((component) => ({
      id: component.id,
      name: component.name,
      status: component.status,
      description: component.description,
    }));
  }

  /**
   * Fetches the full summary from the Cloudflare status page.
   *
   * @returns The complete status API response including page info, status, and components.
   * @throws {Error} If the API request fails or returns an unexpected response.
   */
  async getSummary(): Promise<CloudflareStatusApiResponse> {
    const response = await fetch(`${this.baseUrl}/summary.json`);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Cloudflare summary: HTTP ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as CloudflareStatusApiResponse;
  }
}
