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

/**
 * Cloudflare Status action - displays the current Cloudflare system status
 * on a Stream Deck key. Supports overall status or individual component monitoring.
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.status" })
export class CloudflareStatus extends SingletonAction<CloudflareStatusSettings> {
  private apiClient: CloudflareApiClient;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(apiClient?: CloudflareApiClient) {
    super();
    this.apiClient = apiClient ?? new CloudflareApiClient();
  }

  /**
   * Called when the action appears on the Stream Deck.
   * Sets up periodic status refresh.
   */
  override async onWillAppear(ev: WillAppearEvent<CloudflareStatusSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const refreshIntervalMs = (settings.refreshIntervalSeconds ?? 60) * 1000;

    // Fetch status immediately
    await this.updateStatus(ev);

    // Set up periodic refresh
    this.refreshInterval = setInterval(async () => {
      await this.updateStatus(ev);
    }, refreshIntervalMs);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   * Cleans up the refresh interval.
   */
  override onWillDisappear(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Called when settings change from the Property Inspector.
   * Restarts polling with the new settings.
   */
  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<CloudflareStatusSettings>
  ): Promise<void> {
    // Clear existing interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    const settings = ev.payload.settings;
    const refreshIntervalMs = (settings.refreshIntervalSeconds ?? 60) * 1000;

    // Fetch immediately with new settings
    await this.updateStatus(ev);

    // Restart periodic refresh
    this.refreshInterval = setInterval(async () => {
      await this.updateStatus(ev);
    }, refreshIntervalMs);
  }

  /**
   * Called when the key is pressed. Triggers an immediate status refresh.
   */
  override async onKeyDown(ev: KeyDownEvent<CloudflareStatusSettings>): Promise<void> {
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
    const settings = ev.payload.settings;
    const componentId = settings.componentId;

    try {
      if (componentId) {
        // Component-specific mode
        const components = await this.apiClient.getComponents();
        const component = components.find((c) => c.id === componentId);
        if (!component) {
          await ev.action.setImage(
            renderKeyImage({
              line1: settings.componentName ?? "Component",
              line2: "N/A",
              statusColor: STATUS_COLORS.gray,
            })
          );
          return;
        }
        const label = settings.componentName ?? component.name;
        await ev.action.setImage(this.renderComponentImage(label, component.status));
      } else {
        // Overall status mode (original behavior)
        const status = await this.apiClient.getSystemStatus();
        await ev.action.setImage(this.renderStatusImage(status.indicator));
      }
    } catch (error) {
      streamDeck.logger.error("Failed to fetch Cloudflare status:", error);
      const label = componentId ? (settings.componentName ?? "Component") : "Cloudflare";
      await ev.action.setImage(
        renderKeyImage({
          line1: label,
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
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
}

/**
 * Settings for the Cloudflare Status action.
 */
type CloudflareStatusSettings = {
  /** Refresh interval in seconds (default: 60) */
  refreshIntervalSeconds?: number;
  /** Component ID to monitor (empty = overall status) */
  componentId?: string;
  /** Component display name (for rendering) */
  componentName?: string;
};
