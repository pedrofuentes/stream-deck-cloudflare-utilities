import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";

import { CloudflareWorkersApi, formatTimeAgo, truncateWorkerName } from "../services/cloudflare-workers-api";
import type { CloudflareAuthSettings, DeploymentStatus } from "../types/cloudflare-workers";

/**
 * Settings for the Worker Deployment Status action.
 */
export type WorkerDeploymentSettings = CloudflareAuthSettings & {
  /** Name of the Cloudflare Worker script to monitor */
  workerName?: string;
  /** Refresh interval in seconds (default: 60) */
  refreshIntervalSeconds?: number;
};

/**
 * Visual state identifiers for the Stream Deck key.
 */
type StatusState = "live" | "gradual" | "recent" | "error";

/**
 * Worker Deployment Status action — displays the current deployment status
 * of a Cloudflare Worker on a Stream Deck key.
 *
 * Color-coded states:
 * - 🟢 Green  → live deployment (100% single version)
 * - 🟡 Amber  → gradual rollout (split traffic)
 * - 🔵 Blue   → recently deployed (< 10 min)
 * - 🔴 Red    → error fetching status
 *
 * When not yet configured, the key shows "..." as a passive placeholder.
 * All configuration is done through the Property Inspector.
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.worker-deployment-status" })
export class WorkerDeploymentStatus extends SingletonAction<WorkerDeploymentSettings> {
  private apiClient: CloudflareWorkersApi | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  /** Ten minutes in milliseconds — threshold for "recent" highlight */
  private static readonly RECENT_THRESHOLD_MS = 10 * 60 * 1000;

  /**
   * Called when the action appears on the Stream Deck.
   * Validates settings, creates the API client, and starts periodic refresh.
   */
  override async onWillAppear(ev: WillAppearEvent<WorkerDeploymentSettings>): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.hasRequiredSettings(settings)) {
      await ev.action.setTitle("...");
      return;
    }

    this.apiClient = new CloudflareWorkersApi(settings.apiToken!, settings.accountId!);
    const refreshMs = (settings.refreshIntervalSeconds ?? 60) * 1000;

    // Fetch immediately
    await this.updateStatus(ev);

    // Start periodic refresh
    this.refreshInterval = setInterval(async () => {
      await this.updateStatus(ev);
    }, refreshMs);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   * Cleans up the refresh interval and API client.
   */
  override onWillDisappear(_ev: WillDisappearEvent<WorkerDeploymentSettings>): void {
    this.clearRefreshInterval();
    this.apiClient = null;
  }

  /**
   * Called when the key is pressed. Triggers an immediate status refresh.
   */
  override async onKeyDown(ev: KeyDownEvent<WorkerDeploymentSettings>): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.hasRequiredSettings(settings)) {
      // Nothing to do — configuration happens in the Property Inspector
      return;
    }

    // Recreate client in case settings changed
    this.apiClient = new CloudflareWorkersApi(settings.apiToken!, settings.accountId!);
    await this.updateStatus(ev);
  }

  /**
   * Fetches the deployment status and updates the key display.
   */
  private async updateStatus(
    ev: WillAppearEvent<WorkerDeploymentSettings> | KeyDownEvent<WorkerDeploymentSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.workerName) {
      await ev.action.setTitle("...");
      return;
    }

    try {
      const status = await this.apiClient.getDeploymentStatus(settings.workerName);

      if (!status) {
        await ev.action.setTitle(this.formatTitle("error", settings.workerName, "No deploys"));
        return;
      }

      const state = this.resolveState(status);
      const title = this.formatTitle(state, settings.workerName, undefined, status);
      await ev.action.setTitle(title);
    } catch (error) {
      streamDeck.logger.error(`Failed to fetch deployment status for "${settings.workerName}":`, error);
      await ev.action.setTitle(this.formatTitle("error", settings.workerName));
    }
  }

  /**
   * Determines the visual state based on the deployment status.
   */
  public resolveState(status: DeploymentStatus, now?: number): StatusState {
    if (status.isGradual) {
      return "gradual";
    }

    const currentTime = now ?? Date.now();
    const deployedAt = new Date(status.createdOn).getTime();
    if (!isNaN(deployedAt) && currentTime - deployedAt < WorkerDeploymentStatus.RECENT_THRESHOLD_MS) {
      return "recent";
    }

    if (status.isLive) {
      return "live";
    }

    return "live";
  }

  /**
   * Formats the title text to display on the Stream Deck key.
   *
   * Layout (3 lines max):
   *   Line 1: Worker name (truncated)
   *   Line 2: Status indicator + time ago
   *   Line 3: Version split (if gradual) or source
   */
  public formatTitle(
    state: StatusState,
    workerName?: string,
    errorMessage?: string,
    status?: DeploymentStatus
  ): string {
    const name = workerName ? truncateWorkerName(workerName) : "";

    switch (state) {
      case "error":
        return errorMessage ? `${name}\n🔴 ${errorMessage}` : `${name}\n🔴 ERR`;

      case "recent": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return `${name}\n🔵 ${timeAgo}\n${status?.source ?? ""}`;
      }

      case "gradual": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return `${name}\n🟡 ${timeAgo}\n${status?.versionSplit ?? ""}`;
      }

      case "live": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return `${name}\n🟢 ${timeAgo}\n${status?.source ?? ""}`;
      }

      default:
        return `${name}\n? N/A`;
    }
  }

  /**
   * Checks whether the required settings are present.
   */
  private hasRequiredSettings(settings: WorkerDeploymentSettings): boolean {
    return !!(settings.apiToken && settings.accountId && settings.workerName);
  }

  /**
   * Clears the periodic refresh interval.
   */
  private clearRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}
