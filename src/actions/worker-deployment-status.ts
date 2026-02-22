/**
 * Worker Deployment Status action for Stream Deck.
 *
 * Shows the latest deployment status of a Cloudflare Worker with
 * color-coded indicators and automatic refresh.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import streamDeck, {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";

import { CloudflareWorkersApi, formatTimeAgo, truncateWorkerName } from "../services/cloudflare-workers-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, STATUS_COLORS } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import type { DeploymentStatus } from "../types/cloudflare-workers";

/**
 * Settings for the Worker Deployment Status action (per-button).
 * Auth credentials (apiToken, accountId) are in global settings.
 */
export type WorkerDeploymentSettings = {
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
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastState: StatusState | null = null;

  /** Cached data for display-only refreshes (no API call). */
  private lastStatus: DeploymentStatus | null = null;
  private lastWorkerName: string | null = null;
  private actionRef: { setImage(image: string): Promise<void> } | null = null;

  /** 1-second interval for ticking the seconds display. */
  private displayInterval: ReturnType<typeof setInterval> | null = null;

  /** Stored event reference for re-initialization on global settings change. */
  private lastEvent: WillAppearEvent<WorkerDeploymentSettings> | DidReceiveSettingsEvent<WorkerDeploymentSettings> | null = null;

  /** Unsubscribe function for global settings listener. */
  private unsubscribeGlobal: (() => void) | null = null;

  /** Ten minutes in milliseconds — threshold for "recent" highlight */
  private static readonly RECENT_THRESHOLD_MS = 10 * 60 * 1000;

  /** Fast polling interval for active states (recent / gradual) */
  private static readonly FAST_POLL_MS = 10 * 1000;

  /** Back-off interval after an error */
  private static readonly ERROR_BACKOFF_MS = 30 * 1000;

  /** Marquee tick interval in milliseconds. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long worker names. */
  private marquee = new MarqueeController(10);

  /** Interval handle for the marquee animation timer. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Called when the action appears on the Stream Deck.
   * Validates settings, creates the API client, and starts periodic refresh.
   */
  override async onWillAppear(ev: WillAppearEvent<WorkerDeploymentSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    this.apiClient = new CloudflareWorkersApi(global.apiToken!, global.accountId!);
    this.marquee.setText(settings.workerName ?? "");

    // Fetch immediately, then schedule adaptive polling
    await this.updateStatus(ev);
    this.scheduleRefresh(ev);
  }

  /**
   * Called when settings are updated via the Property Inspector.
   * Re-initializes the API client and restarts the refresh cycle.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WorkerDeploymentSettings>): Promise<void> {
    this.lastEvent = ev;

    // Tear down existing refresh cycle
    this.clearRefreshTimeout();
    this.clearDisplayInterval();
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastState = null;
    this.lastStatus = null;
    this.lastWorkerName = null;

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    this.apiClient = new CloudflareWorkersApi(global.apiToken!, global.accountId!);
    this.marquee.setText(settings.workerName ?? "");

    // Fetch immediately with new settings, then schedule adaptive polling
    await this.updateStatus(ev);
    this.scheduleRefresh(ev);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   * Cleans up the refresh interval and API client.
   */
  override onWillDisappear(_ev: WillDisappearEvent<WorkerDeploymentSettings>): void {
    this.clearRefreshTimeout();
    this.clearDisplayInterval();
    this.stopMarqueeTimer();
    this.marquee.setText("");
    this.apiClient = null;
    this.lastState = null;
    this.lastStatus = null;
    this.lastWorkerName = null;
    this.actionRef = null;
    this.lastEvent = null;
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
      this.unsubscribeGlobal = null;
    }
  }

  /**
   * Called when the key is pressed. Triggers an immediate status refresh.
   */
  override async onKeyDown(ev: KeyDownEvent<WorkerDeploymentSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      // Nothing to do — configuration happens in the Property Inspector
      return;
    }

    // Recreate client in case settings changed
    this.apiClient = new CloudflareWorkersApi(global.apiToken!, global.accountId!);
    await this.updateStatus(ev);
  }

  /**
   * Fetches the deployment status and updates the key display.
   */
  private async updateStatus(
    ev: WillAppearEvent<WorkerDeploymentSettings> | KeyDownEvent<WorkerDeploymentSettings> | DidReceiveSettingsEvent<WorkerDeploymentSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.workerName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    try {
      const status = await this.apiClient.getDeploymentStatus(settings.workerName);

      if (!status) {
        await ev.action.setImage(this.renderStatus("error", settings.workerName, "No deploys"));
        this.startMarqueeIfNeeded();
        return;
      }

      const state = this.resolveState(status);
      this.lastState = state;
      this.lastStatus = status;
      this.lastWorkerName = settings.workerName ?? null;
      this.actionRef = ev.action as unknown as { setImage(image: string): Promise<void> };
      await ev.action.setImage(this.renderStatus(state, settings.workerName, undefined, status));
      this.startMarqueeIfNeeded();
      this.startDisplayRefresh();
    } catch (error) {
      this.lastState = "error";
      this.lastStatus = null;
      this.clearDisplayInterval();
      streamDeck.logger.error(`Failed to fetch deployment status for "${settings.workerName}":`, error);
      await ev.action.setImage(this.renderStatus("error", settings.workerName));
      this.startMarqueeIfNeeded();
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
   * Renders a data URI SVG image for the Stream Deck key.
   *
   * Layout (3 lines):
   *   Line 1: Worker name (truncated)
   *   Line 2: Status label (with colored dot)
   *   Line 3: Time ago + source/split
   */
  public renderStatus(
    state: StatusState,
    workerName?: string,
    errorMessage?: string,
    status?: DeploymentStatus,
    displayName?: string,
  ): string {
    const name = displayName
      ?? (workerName ? (this.marquee.needsAnimation() ? this.marquee.getCurrentText() : truncateWorkerName(workerName)) : "");

    switch (state) {
      case "error":
        return renderKeyImage({
          line1: name,
          line2: errorMessage ?? "ERR",
          statusColor: STATUS_COLORS.red,
        });

      case "recent": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return renderKeyImage({
          line1: name,
          line2: timeAgo || "Recent",
          line3: status?.source ?? "",
          statusColor: STATUS_COLORS.blue,
        });
      }

      case "gradual": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return renderKeyImage({
          line1: name,
          line2: timeAgo || "Gradual",
          line3: status?.versionSplit ?? "",
          statusColor: STATUS_COLORS.orange,
        });
      }

      case "live": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return renderKeyImage({
          line1: name,
          line2: timeAgo || "Live",
          line3: status?.source ?? "",
          statusColor: STATUS_COLORS.green,
        });
      }

      default:
        return renderKeyImage({
          line1: name,
          line2: "N/A",
          statusColor: STATUS_COLORS.gray,
        });
    }
  }

  /**
   * Checks whether the required settings are present.
   */
  private hasRequiredSettings(settings: WorkerDeploymentSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.workerName);
  }

  /**
   * Returns the appropriate polling interval in ms based on the current state.
   *
   * - "recent" / "gradual" → fast poll (10 s) for responsive feedback
   * - "error"              → back-off (30 s) to avoid hammering a failing API
   * - "live" / default     → user-configured interval (default 60 s)
   */
  public getPollingInterval(state: StatusState | null, baseIntervalSeconds: number): number {
    switch (state) {
      case "recent":
      case "gradual":
        return WorkerDeploymentStatus.FAST_POLL_MS;
      case "error":
        return WorkerDeploymentStatus.ERROR_BACKOFF_MS;
      default:
        return baseIntervalSeconds * 1000;
    }
  }

  /**
   * Schedules the next poll using setTimeout. The delay is chosen adaptively
   * based on the last resolved state.
   */
  private scheduleRefresh(
    ev: WillAppearEvent<WorkerDeploymentSettings> | DidReceiveSettingsEvent<WorkerDeploymentSettings>
  ): void {
    this.clearRefreshTimeout();

    const baseSeconds = ev.payload.settings.refreshIntervalSeconds ?? 60;
    const delayMs = this.getPollingInterval(this.lastState, baseSeconds);

    this.refreshTimeout = setTimeout(async () => {
      await this.updateStatus(ev);
      this.scheduleRefresh(ev);
    }, delayMs);
  }

  /**
   * Clears the pending refresh timeout.
   */
  private clearRefreshTimeout(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  /**
   * Starts a 1-second display refresh interval so that the seconds counter
   * ("45s → 46s → 47s") ticks smoothly without waiting for the next API poll.
   *
   * The interval automatically stops when the display moves past seconds
   * (into minutes/hours) or when the state changes.
   */
  private startDisplayRefresh(): void {
    this.clearDisplayInterval();

    if (!this.lastStatus || !this.actionRef || !this.lastWorkerName) return;

    // Only tick when the display is showing seconds
    if (!this.isShowingSeconds()) return;

    this.displayInterval = setInterval(async () => {
      if (!this.lastStatus || !this.actionRef || !this.lastWorkerName) {
        this.clearDisplayInterval();
        return;
      }

      // Re-resolve state in case recent → live transition happened
      const state = this.resolveState(this.lastStatus);
      if (state !== this.lastState) {
        this.lastState = state;
      }

      await this.actionRef.setImage(
        this.renderStatus(state, this.lastWorkerName!, undefined, this.lastStatus,
          this.marquee.needsAnimation() ? this.marquee.getCurrentText() : undefined)
      );

      // Stop ticking once we're past seconds display
      if (!this.isShowingSeconds()) {
        this.clearDisplayInterval();
      }
    }, 1000);
  }

  /**
   * Returns true if the cached status would display seconds (e.g., "45s").
   */
  private isShowingSeconds(): boolean {
    if (!this.lastStatus) return false;
    return formatTimeAgo(this.lastStatus.createdOn).endsWith("s");
  }

  /**
   * Clears the 1-second display refresh interval.
   */
  private clearDisplayInterval(): void {
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = null;
    }
  }

  /**
   * Subscribes to global settings changes so the action re-initializes
   * when the user saves credentials in the setup window.
   */
  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return; // already subscribed

    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;

      // Re-run the same flow as onDidReceiveSettings
      this.clearRefreshTimeout();
      this.clearDisplayInterval();
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastState = null;
      this.lastStatus = null;
      this.lastWorkerName = null;

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareWorkersApi(global.apiToken!, global.accountId!);
      this.marquee.setText(settings.workerName ?? "");

      await this.updateStatus(ev);
      this.scheduleRefresh(ev);
    });
  }

  /**
   * Starts the marquee animation interval if the worker name is too
   * long for the key display.
   */
  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation()) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(() => this.onMarqueeTick(), WorkerDeploymentStatus.MARQUEE_INTERVAL_MS);
      }
    } else {
      this.stopMarqueeTimer();
    }
  }

  /**
   * Stops the marquee animation interval.
   */
  private stopMarqueeTimer(): void {
    if (this.marqueeInterval) {
      clearInterval(this.marqueeInterval);
      this.marqueeInterval = null;
    }
  }

  /**
   * Marquee tick handler — advances the scroll position and re-renders
   * the key image if the visible text changed.
   */
  private async onMarqueeTick(): Promise<void> {
    const changed = this.marquee.tick();
    if (!changed || !this.actionRef || !this.lastWorkerName) return;

    const state = this.lastState ?? "live";
    await this.actionRef.setImage(
      this.renderStatus(state, this.lastWorkerName, undefined, this.lastStatus ?? undefined,
        this.marquee.getCurrentText())
    );
  }
}
