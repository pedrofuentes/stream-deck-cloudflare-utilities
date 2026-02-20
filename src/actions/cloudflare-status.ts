import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

import { CloudflareApiClient } from "../services/cloudflare-api-client";

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
      const title = this.formatStatusTitle(status.indicator);
      await ev.action.setTitle(title);
    } catch (error) {
      streamDeck.logger.error("Failed to fetch Cloudflare status:", error);
      await ev.action.setTitle("ERR");
    }
  }

  /**
   * Maps a status indicator to a display-friendly title.
   */
  public formatStatusTitle(indicator: string): string {
    switch (indicator) {
      case "none":
        return "✓ OK";
      case "minor":
        return "⚠ Minor";
      case "major":
        return "✖ Major";
      case "critical":
        return "🔴 Crit";
      default:
        return "? N/A";
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
