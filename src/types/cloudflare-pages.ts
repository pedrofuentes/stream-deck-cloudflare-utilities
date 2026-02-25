/**
 * Cloudflare Pages API type definitions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Settings for the Pages Deployment Status action.
 */
export type PagesDeploymentSettings = {
  /** Name of the Cloudflare Pages project to monitor */
  projectName?: string;
};

/**
 * A Pages project from the list endpoint.
 */
export interface PagesProject {
  /** Project name (slug) */
  name: string;
  /** Subdomain (e.g. "my-site.pages.dev") */
  subdomain: string;
  /** Production branch */
  production_branch: string;
  /** ISO 8601 datetime */
  created_on: string;
}

/**
 * A single Pages deployment.
 */
export interface PagesDeployment {
  /** Deployment UUID */
  id: string;
  /** Short hash */
  short_id: string;
  /** Project ID */
  project_id: string;
  /** Project name */
  project_name: string;
  /** Environment: "production" or "preview" */
  environment: string;
  /** Deployment URL */
  url: string;
  /** ISO 8601 datetime */
  created_on: string;
  /** ISO 8601 datetime */
  modified_on: string;
  /** Build configuration */
  build_config?: {
    build_command: string;
    destination_dir: string;
  };
  /** Source information */
  source?: {
    type: string;
    config?: {
      owner?: string;
      repo_name?: string;
      production_branch?: string;
    };
  };
  /** Latest deployment stage */
  latest_stage: {
    /** Stage name: "build" | "deploy" | "queued" | "initialize" */
    name: string;
    /** Stage status: "active" | "success" | "failure" | "idle" */
    status: string;
    /** ISO 8601 datetime when stage started */
    started_on: string | null;
    /** ISO 8601 datetime when stage ended */
    ended_on: string | null;
  };
  /** Deployment trigger metadata */
  deployment_trigger?: {
    type: string;
    metadata: {
      branch: string;
      commit_hash: string;
      commit_message: string;
    };
  };
  /** Build image version */
  build_image_major_version?: number;
}

/**
 * API response for Pages projects list.
 */
export interface PagesProjectsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: PagesProject[];
}

/**
 * API response for Pages deployments list.
 */
export interface PagesDeploymentsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: PagesDeployment[];
}
