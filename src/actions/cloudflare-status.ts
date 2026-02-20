import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

import { CloudflareApiClient } from "../services/cloudflare-api-client";
import { renderKeyImage, STATUS_COLORS } from "../services/key-image-renderer";

/**
 * Cloudflare Status action - displays the current Cloudflare system status
 * on a Stream Deck key.
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
   * Called when the key is pressed. Triggers an immediate status refresh.
   */
  override async onKeyDown(ev: KeyDownEvent<CloudflareStatusSettings>): Promise<void> {
    await this.updateStatus(ev);
  }

  /**
   * Fetches the current Cloudflare status and updates the key display.
   */
  private async updateStatus(
    ev: WillAppearEvent<CloudflareStatusSettings> | KeyDownEvent<CloudflareStatusSettings>
  ): Promise<void> {
    try {
      const status = await this.apiClient.getSystemStatus();
      await ev.action.setImage(this.renderStatusImage(status.indicator));
    } catch (error) {
      streamDeck.logger.error("Failed to fetch Cloudflare status:", error);
      await ev.action.setImage(renderKeyImage({
        line1: "Cloudflare",
        line2: "ERR",
        statusColor: STATUS_COLORS.red,
      }));
    }
  }

  /**
   * Renders an SVG data URI for the given status indicator.
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
}

/**
 * Settings for the Cloudflare Status action.
 */
type CloudflareStatusSettings = {
  /** Refresh interval in seconds (default: 60) */
  refreshIntervalSeconds?: number;
};
