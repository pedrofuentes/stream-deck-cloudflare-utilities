/**
 * Cloudflare Workers API client.
 *
 * Fetches worker scripts and deployment information from the Cloudflare API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  WorkerDeployment,
  WorkerDeploymentsApiResponse,
  WorkerScript,
  WorkerScriptsApiResponse,
  WorkerVersion,
  WorkerVersionsApiResponse,
  DeploymentStatus,
} from "../types/cloudflare-workers";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Client for interacting with the Cloudflare Workers API.
 *
 * Requires a Cloudflare API Token with "Workers Scripts Read" permission.
 *
 * @see https://developers.cloudflare.com/api/resources/workers/
 */
export class CloudflareWorkersApi {
  private baseUrl: string;
  private apiToken: string;
  private accountId: string;

  constructor(apiToken: string, accountId: string, baseUrl?: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.baseUrl = baseUrl ?? CLOUDFLARE_API_BASE;
  }

  /**
   * Fetches the list of Worker scripts for the account.
   *
   * @returns Array of worker scripts, sorted alphabetically by name
   * @throws {Error} If the API request fails
   */
  async listWorkers(): Promise<WorkerScript[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch workers: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as WorkerScriptsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Fetches the list of deployments for a worker script.
   * The first deployment in the returned array is the latest (currently serving traffic).
   *
   * @param scriptName - Name of the worker script
   * @returns Array of deployments, newest first
   * @throws {Error} If the API request fails
   */
  async getDeployments(scriptName: string): Promise<WorkerDeployment[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch deployments for "${scriptName}": HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as WorkerDeploymentsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.deployments;
  }

  /**
   * Fetches the latest deployment for a worker script.
   *
   * @param scriptName - Name of the worker script
   * @returns The latest deployment, or null if no deployments exist
   * @throws {Error} If the API request fails
   */
  async getLatestDeployment(scriptName: string): Promise<WorkerDeployment | null> {
    const deployments = await this.getDeployments(scriptName);
    return deployments.length > 0 ? deployments[0] : null;
  }

  /**
   * Fetches the list of versions for a worker script.
   *
   * @param scriptName - Name of the worker script
   * @returns Array of versions, newest first
   * @throws {Error} If the API request fails
   */
  async getVersions(scriptName: string): Promise<WorkerVersion[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/versions`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch versions for "${scriptName}": HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as WorkerVersionsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result;
  }

  /**
   * Fetches the latest deployment and processes it into a display-friendly status.
   *
   * @param scriptName - Name of the worker script
   * @returns Processed deployment status, or null if no deployments exist
   * @throws {Error} If the API request fails
   */
  async getDeploymentStatus(scriptName: string): Promise<DeploymentStatus | null> {
    const deployment = await this.getLatestDeployment(scriptName);

    if (!deployment) {
      return null;
    }

    return CloudflareWorkersApi.toDeploymentStatus(deployment);
  }

  /**
   * Converts a raw deployment object into a processed DeploymentStatus.
   *
   * @param deployment - Raw deployment from the API
   * @returns Processed deployment status
   */
  static toDeploymentStatus(deployment: WorkerDeployment): DeploymentStatus {
    const versions = deployment.versions ?? [];
    const isGradual = versions.length > 1;
    const isLive = versions.length === 1 && versions[0].percentage === 100;

    let versionSplit: string;
    if (versions.length === 0) {
      versionSplit = "0";
    } else if (versions.length === 1) {
      versionSplit = `${versions[0].percentage}`;
    } else {
      versionSplit = versions.map((v) => `${v.percentage}`).join("/");
    }

    return {
      isLive,
      isGradual,
      createdOn: deployment.created_on,
      source: deployment.source,
      versionSplit,
      message: deployment.annotations?.["workers/message"],
      deploymentId: deployment.id,
    };
  }
}

/**
 * Formats an ISO 8601 date string into a compact time-ago string.
 *
 * @param isoDate - ISO 8601 datetime string
 * @param now - Current time (defaults to Date.now(), injectable for testing)
 * @returns Compact time-ago string, e.g. "2m", "1h", "3d", "2w"
 */
export function formatTimeAgo(isoDate: string, now?: number): string {
  const then = new Date(isoDate).getTime();
  const currentTime = now ?? Date.now();

  if (isNaN(then)) {
    return "??";
  }

  const diffMs = currentTime - then;

  if (diffMs < 0) {
    return "now";
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (weeks > 0) {
    return `${weeks}w`;
  }
  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Truncates a worker name for display on a Stream Deck key.
 * Stream Deck keys have very limited horizontal space.
 *
 * @param name - Full worker script name
 * @param maxLength - Maximum character length (default: 8)
 * @returns Truncated name
 */
export function truncateWorkerName(name: string, maxLength: number = 8): string {
  if (!name) {
    return "";
  }
  if (name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength);
}
