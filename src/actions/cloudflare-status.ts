/**
 * Cloudflare Status action for Stream Deck.
 *
 * Displays the current Cloudflare system status with automatic refresh.
 * Supports both overall status and individual component drill-down.
 * Press the key for an instant status check.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  DidReceiveSettingsEvent,
} from "@elgato/streamdeck";

import { CloudflareApiClient } from "../services/cloudflare-api-client";
import { renderKeyImage, STATUS_COLORS } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";

/**
 * Cloudflare Status action - displays the current Cloudflare system status
 * on a Stream Deck key. Supports overall status or individual component monitoring.
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.status" })
export class CloudflareStatus extends SingletonAction<CloudflareStatusSettings> {
  private apiClient: CloudflareApiClient;

  /** Consecutive error count for exponential backoff */
  private consecutiveErrors = 0;
  /** Maximum backoff multiplier (caps at 2^5 = 32x the base interval) */
  private static readonly MAX_BACKOFF_EXPONENT = 5;
  /** Timestamp until which coordinator ticks should be skipped (backoff) */
  private skipUntil = 0;

  /** Marquee tick interval in milliseconds. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long component names. */
  private marquee = new MarqueeController(10);

  /** Interval handle for the marquee animation timer. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /** Stored event reference for marquee re-rendering and coordinator tick. */
  private lastEvent: WillAppearEvent<CloudflareStatusSettings>
    | KeyDownEvent<CloudflareStatusSettings>
    | DidReceiveSettingsEvent<CloudflareStatusSettings>
    | null = null;

  /** Last rendered image parameters for marquee re-rendering. */
  private lastRenderParams: { line2: string; statusColor: string } | null = null;

  /** Unsubscribe function for the polling coordinator. */
  private unsubscribeCoordinator: (() => void) | null = null;

  constructor(apiClient?: CloudflareApiClient) {
    super();
    this.apiClient = apiClient ?? new CloudflareApiClient();
  }

  /**
   * Called when the action appears on the Stream Deck.
   * Subscribes to the polling coordinator and fetches status immediately.
   */
  override async onWillAppear(ev: WillAppearEvent<CloudflareStatusSettings>): Promise<void> {
    this.lastEvent = ev;

    // Fetch status immediately
    await this.updateStatus(ev);

    // Subscribe to the shared polling coordinator
    this.subscribeToCoordinator();
  }

  /**
   * Called when the action disappears from the Stream Deck.
   * Cleans up the coordinator subscription.
   */
  override onWillDisappear(): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.marquee.setText("");
    this.lastEvent = null;
    this.lastRenderParams = null;
  }

  /**
   * Called when settings change from the Property Inspector.
   * Fetches immediately with new settings.
   */
  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<CloudflareStatusSettings>
  ): Promise<void> {
    this.lastEvent = ev;
    // Fetch immediately with new settings
    await this.updateStatus(ev);
  }

  /**
   * Called when the key is pressed. Triggers an immediate status refresh.
   * Resets backoff so the user can force a retry after errors.
   */
  override async onKeyDown(ev: KeyDownEvent<CloudflareStatusSettings>): Promise<void> {
    this.consecutiveErrors = 0;
    this.skipUntil = 0;
    await this.updateStatus(ev);
  }

  /**
   * Fetches the current Cloudflare status and updates the key display.
   * Uses component-specific status when componentId is set, otherwise overall status.
   */
  private async updateStatus(
    ev:
      | WillAppearEvent<CloudflareStatusSettings>
      | KeyDownEvent<CloudflareStatusSettings>
      | DidReceiveSettingsEvent<CloudflareStatusSettings>
  ): Promise<void> {
    this.lastEvent = ev;
    const settings = ev.payload.settings;
    const componentId = settings.componentId;

    // Set marquee text based on mode
    const rawLabel = componentId
      ? (settings.componentName ?? "Component")
      : "Cloudflare";
    this.marquee.setText(rawLabel);

    try {
      if (componentId) {
        // Component-specific mode
        const components = await this.apiClient.getComponents();
        const component = components.find((c) => c.id === componentId);
        if (!component) {
          this.lastRenderParams = { line2: "N/A", statusColor: STATUS_COLORS.gray };
          await ev.action.setImage(
            renderKeyImage({
              line1: this.marquee.needsAnimation() ? this.marquee.getCurrentText() : rawLabel,
              line2: "N/A",
              statusColor: STATUS_COLORS.gray,
            })
          );
          this.startMarqueeIfNeeded();
          return;
        }
        const label = settings.componentName ?? component.name;
        this.marquee.setText(label);
        const { label: statusLabel, color } = CloudflareStatus.mapComponentStatus(component.status);
        this.lastRenderParams = { line2: statusLabel, statusColor: color };
        await ev.action.setImage(
          renderKeyImage({
            line1: this.marquee.needsAnimation() ? this.marquee.getCurrentText() : label,
            line2: statusLabel,
            statusColor: color,
          })
        );
        this.startMarqueeIfNeeded();
      } else {
        // Overall status mode (original behavior)
        const status = await this.apiClient.getSystemStatus();
        const image = this.renderStatusImage(status.indicator);
        this.lastRenderParams = null; // renderStatusImage uses "Cloudflare" which is ≤10 chars
        this.stopMarqueeTimer();
        await ev.action.setImage(image);
      }
      // Success — reset backoff
      this.consecutiveErrors = 0;
      this.skipUntil = 0;
    } catch (error) {
      streamDeck.logger.error("Failed to fetch Cloudflare status:", error);

      // Exponential backoff: delay retries using skipUntil timestamp
      this.consecutiveErrors = Math.min(
        this.consecutiveErrors + 1,
        CloudflareStatus.MAX_BACKOFF_EXPONENT
      );
      const backoffMs = Math.pow(2, this.consecutiveErrors) * getPollingCoordinator().intervalMs;
      this.skipUntil = Date.now() + backoffMs;
      streamDeck.logger.info(
        `Backoff: skipping polls for ${Math.round(backoffMs / 1000)}s after ${this.consecutiveErrors} consecutive error(s)`
      );

      this.lastRenderParams = { line2: "ERR", statusColor: STATUS_COLORS.red };
      await ev.action.setImage(
        renderKeyImage({
          line1: this.marquee.needsAnimation() ? this.marquee.getCurrentText() : rawLabel,
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
      this.startMarqueeIfNeeded();
    }
  }

  /**
   * Renders an SVG data URI for the given overall status indicator.
   */
  public renderStatusImage(indicator: string): string {
    switch (indicator) {
      case "none":
        return renderKeyImage({
          line1: "Cloudflare",
          line2: "OK",
          statusColor: STATUS_COLORS.green,
        });
      case "minor":
        return renderKeyImage({
          line1: "Cloudflare",
          line2: "Minor",
          statusColor: STATUS_COLORS.amber,
        });
      case "major":
        return renderKeyImage({
          line1: "Cloudflare",
          line2: "Major",
          statusColor: STATUS_COLORS.red,
        });
      case "critical":
        return renderKeyImage({
          line1: "Cloudflare",
          line2: "Critical",
          statusColor: STATUS_COLORS.red,
        });
      default:
        return renderKeyImage({
          line1: "Cloudflare",
          line2: "N/A",
          statusColor: STATUS_COLORS.gray,
        });
    }
  }

  /**
   * Renders an SVG data URI for a specific component's status.
   *
   * Component statuses: "operational" | "degraded_performance" |
   * "partial_outage" | "major_outage" | "under_maintenance"
   */
  public renderComponentImage(componentName: string, status: string): string {
    const { label, color } = CloudflareStatus.mapComponentStatus(status);
    return renderKeyImage({
      line1: componentName,
      line2: label,
      statusColor: color,
    });
  }

  /**
   * Maps a component status string to a display label and color.
   */
  public static mapComponentStatus(status: string): { label: string; color: string } {
    switch (status) {
      case "operational":
        return { label: "OK", color: STATUS_COLORS.green };
      case "degraded_performance":
        return { label: "Degraded", color: STATUS_COLORS.amber };
      case "partial_outage":
        return { label: "Partial", color: STATUS_COLORS.amber };
      case "major_outage":
        return { label: "Outage", color: STATUS_COLORS.red };
      case "under_maintenance":
        return { label: "Maint", color: STATUS_COLORS.blue };
      default:
        return { label: "N/A", color: STATUS_COLORS.gray };
    }
  }

  /**
   * Subscribes to the shared polling coordinator for periodic refreshes.
   */
  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return; // already subscribed

    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      "com.pedrofuentes.cloudflare-utilities.status",
      async () => {
        // Skip if in backoff
        if (Date.now() < this.skipUntil) return;
        if (!this.lastEvent) return;
        await this.updateStatus(this.lastEvent);
      },
    );
  }

  /**
   * Starts the marquee animation interval if the component name is too
   * long for the key display.
   */
  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastRenderParams) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(() => this.onMarqueeTick(), CloudflareStatus.MARQUEE_INTERVAL_MS);
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
    if (!changed || !this.lastEvent || !this.lastRenderParams) return;

    await this.lastEvent.action.setImage(
      renderKeyImage({
        line1: this.marquee.getCurrentText(),
        line2: this.lastRenderParams.line2,
        statusColor: this.lastRenderParams.statusColor,
      })
    );
  }
}

/**
 * Settings for the Cloudflare Status action.
 */
type CloudflareStatusSettings = {
  /** Component ID to monitor (empty = overall status) */
  componentId?: string;
  /** Component display name (for rendering) */
  componentName?: string;
};
