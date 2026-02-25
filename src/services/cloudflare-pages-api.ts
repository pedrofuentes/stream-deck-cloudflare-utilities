/**
 * Cloudflare Pages API client.
 *
 * Fetches Pages projects and deployment information from the Cloudflare API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  PagesProject,
  PagesDeployment,
  PagesProjectsApiResponse,
  PagesDeploymentsApiResponse,
} from "../types/cloudflare-pages";
import { LINE1_MAX_CHARS, truncateForDisplay } from "./key-image-renderer";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Processed deployment status for display on a Stream Deck key.
 */
export interface PagesDeploymentStatus {
  /** Whether the latest deployment succeeded */
  isSuccess: boolean;
  /** Whether the deployment is currently building */
  isBuilding: boolean;
  /** Whether the deployment failed */
  isFailed: boolean;
  /** ISO 8601 datetime of the deployment */
  createdOn: string;
  /** Git branch name */
  branch: string;
  /** Short commit hash */
  commitHash: string;
  /** Commit message (may be truncated) */
  commitMessage: string;
  /** Environment: "production" or "preview" */
  environment: string;
  /** Deployment ID */
  deploymentId: string;
}

/**
 * Client for interacting with the Cloudflare Pages API.
 *
 * Requires a Cloudflare API Token with "Pages Read" permission.
 */
export class CloudflarePagesApi {
  private baseUrl: string;
  private apiToken: string;
  private accountId: string;

  constructor(apiToken: string, accountId: string, baseUrl?: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.baseUrl = baseUrl ?? CLOUDFLARE_API_BASE;
  }

  /**
   * Fetches the list of Pages projects for the account.
   *
   * @returns Array of projects, sorted alphabetically by name
   * @throws {Error} If the API request fails
   */
  async listProjects(): Promise<PagesProject[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/pages/projects`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Pages projects: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as PagesProjectsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetches deployments for a Pages project.
   *
   * @param projectName - Name of the project
   * @returns Array of deployments, newest first
   * @throws {Error} If the API request fails
   */
  async getDeployments(projectName: string): Promise<PagesDeployment[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`;
    const response = await fetch(url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch deployments for "${projectName}": HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as PagesDeploymentsApiResponse;

    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown API error";
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result;
  }

  /**
   * Fetches the latest deployment and processes it into a display-friendly status.
   *
   * @param projectName - Name of the project
   * @returns Processed deployment status, or null if no deployments exist
   * @throws {Error} If the API request fails
   */
  async getDeploymentStatus(projectName: string): Promise<PagesDeploymentStatus | null> {
    const deployments = await this.getDeployments(projectName);

    if (deployments.length === 0) {
      return null;
    }

    return CloudflarePagesApi.toDeploymentStatus(deployments[0]);
  }

  /**
   * Converts a raw deployment into a processed status.
   */
  static toDeploymentStatus(deployment: PagesDeployment): PagesDeploymentStatus {
    const stage = deployment.latest_stage;
    const isSuccess = stage?.status === "success";
    const isFailed = stage?.status === "failure";
    const isBuilding = stage?.status === "active" || stage?.status === "idle";

    const trigger = deployment.deployment_trigger?.metadata;

    return {
      isSuccess,
      isBuilding,
      isFailed,
      createdOn: deployment.created_on,
      branch: trigger?.branch ?? "",
      commitHash: trigger?.commit_hash ? trigger.commit_hash.slice(0, 7) : "",
      commitMessage: trigger?.commit_message ?? "",
      environment: deployment.environment,
      deploymentId: deployment.id,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }
}

/**
 * Truncates a project name for display on a tiny OLED key.
 * Max 10 characters, appends "…" if truncated.
 */
export function truncateProjectName(name: string): string {
  return truncateForDisplay(name, LINE1_MAX_CHARS);
}
