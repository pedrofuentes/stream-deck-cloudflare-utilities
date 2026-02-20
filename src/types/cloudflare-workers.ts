/**
 * Settings required for authenticated Cloudflare API actions.
 * These are entered by the user in the Property Inspector.
 */
export type CloudflareAuthSettings = {
  /** Cloudflare API Bearer token with Workers Scripts Read permission */
  apiToken?: string;
  /** Cloudflare Account ID (32-char hex) */
  accountId?: string;
};

/**
 * A single version reference within a deployment.
 */
export interface DeploymentVersion {
  /** Version UUID */
  version_id: string;
  /** Percentage of traffic routed to this version (0-100) */
  percentage: number;
}

/**
 * Represents a single Worker deployment from the Cloudflare API.
 */
export interface WorkerDeployment {
  /** Deployment UUID */
  id: string;
  /** ISO 8601 datetime when the deployment was created */
  created_on: string;
  /** What triggered the deployment (e.g. "wrangler", "dashboard", "api") */
  source: string;
  /** Deployment strategy */
  strategy: string;
  /** Version(s) actively serving traffic */
  versions: DeploymentVersion[];
  /** Optional annotations/metadata attached to the deployment */
  annotations?: {
    /** User-provided deployment message */
    "workers/message"?: string;
    /** User-provided deployment tag */
    "workers/tag"?: string;
  };
}

/**
 * API response shape from GET /accounts/{account_id}/workers/scripts/{script_name}/deployments
 */
export interface WorkerDeploymentsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: {
    deployments: WorkerDeployment[];
  };
}

/**
 * Metadata for a Worker version.
 */
export interface WorkerVersionMetadata {
  /** Who created this version */
  created_by: string;
  /** How this version was created */
  source: string;
  /** ISO 8601 datetime when this version was created */
  created_on: string;
  /** ISO 8601 datetime when this version was last modified */
  modified_on: string;
  /** Optional version message */
  message?: string;
  /** Optional version tag */
  tag?: string;
}

/**
 * A single Worker version from the Cloudflare API.
 */
export interface WorkerVersion {
  /** Version UUID */
  id: string;
  /** Sequential version number */
  number: number;
  /** Version metadata */
  metadata: WorkerVersionMetadata;
}

/**
 * API response shape from GET /accounts/{account_id}/workers/scripts/{script_name}/versions
 */
export interface WorkerVersionsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: WorkerVersion[];
}

/**
 * Minimal representation of a Worker script from the list endpoint.
 */
export interface WorkerScript {
  /** Script name (also used as identifier) */
  id: string;
  /** ISO 8601 datetime when the script was created */
  created_on: string;
  /** ISO 8601 datetime when the script was last modified */
  modified_on: string;
}

/**
 * API response shape from GET /accounts/{account_id}/workers/scripts
 */
export interface WorkerScriptsApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: WorkerScript[];
}

/**
 * Processed deployment status used internally by the action.
 */
export interface DeploymentStatus {
  /** Whether the deployment is live (100% on a single version) */
  isLive: boolean;
  /** Whether this is a gradual rollout (split across versions) */
  isGradual: boolean;
  /** ISO 8601 datetime when the deployment was created */
  createdOn: string;
  /** Source that triggered the deployment */
  source: string;
  /** Version percentages for display (e.g. "100" or "60/40") */
  versionSplit: string;
  /** Optional deployment message */
  message?: string;
  /** Deployment ID */
  deploymentId: string;
}
