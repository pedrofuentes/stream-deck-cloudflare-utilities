/**
 * AI Gateway Metric action for Stream Deck.
 *
 * Displays real-time metrics from a Cloudflare AI Gateway with
 * adaptive polling, marquee scrolling, and metric cycling via key press.
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

import {
  CloudflareAiGatewayApi,
  formatCompactNumber,
  formatCost,
  RateLimitError,
} from "../services/cloudflare-ai-gateway-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import type {
  AiGatewayMetricSettings,
  AiGatewayMetricType,
  AiGatewayMetrics,
} from "../types/cloudflare-ai-gateway";
import { METRIC_CYCLE_ORDER, METRIC_LABELS, METRIC_SHORT_LABELS } from "../types/cloudflare-ai-gateway";

/**
 * Truncates a gateway name for display on a tiny OLED key.
 * Max 10 characters, appends "…" if truncated.
 */
export function truncateGatewayName(name: string): string {
  if (name.length <= 10) return name;
  return name.slice(0, 9) + "…";
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: AiGatewayMetricType): string {
  switch (metric) {
    case "requests":
      return STATUS_COLORS.blue;
    case "tokens":
      return STATUS_COLORS.blue;
    case "cost":
      return STATUS_COLORS.green;
    case "errors":
      return STATUS_COLORS.red;
    case "error_rate":
      return STATUS_COLORS.red;
    case "cache_hit_rate":
      return STATUS_COLORS.green;
    case "logs_stored":
      return STATUS_COLORS.blue;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(metric: AiGatewayMetricType, metrics: AiGatewayMetrics): string {
  switch (metric) {
    case "requests":
      return formatCompactNumber(metrics.requests);
    case "tokens":
      return formatCompactNumber(metrics.tokens);
    case "cost":
      return formatCost(metrics.cost);
    case "errors":
      return formatCompactNumber(metrics.errors);
    case "error_rate":
      if (metrics.requests === 0) return "0%";
      return `${((metrics.errors / metrics.requests) * 100).toFixed(1).replace(/\.0$/, "")}%`;
    case "cache_hit_rate":
      if (metrics.tokens === 0) return "0%";
      return `${((metrics.cachedTokens / metrics.tokens) * 100).toFixed(1).replace(/\.0$/, "")}%`;
    case "logs_stored":
      return formatCompactNumber(metrics.logsStored);
    default:
      return "N/A";
  }
}

/**
 * AI Gateway Metric action — displays a selected metric from a Cloudflare
 * AI Gateway on a Stream Deck key.
 *
 * Pressing the key cycles through available metrics:
 *   Requests → Tokens → Cost → Errors → Logs → (repeat)
 *
 * Color-coded accent bar:
 * - 🔵 Blue   → requests / tokens / logs
 * - 🟢 Green  → cost
 * - 🔴 Red    → errors
 * - ⚪ Gray   → error / loading state
 *
 * All configuration is done through the Property Inspector.
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.ai-gateway-metric" })
export class AiGatewayMetric extends SingletonAction<AiGatewayMetricSettings> {
  private apiClient: CloudflareAiGatewayApi | null = null;

  /**
   * Fetch generation counter. Incremented before every fetch so stale
   * async completions can detect they are outdated and skip rendering.
   */
  private fetchGeneration = 0;

  /** Cached metrics for display on key press cycling (avoids re-fetch). */
  private lastMetrics: AiGatewayMetrics | null = null;
  private lastGatewayId: string | null = null;

  /**
   * The metric currently shown on the key. This is the authoritative
   * source of truth for rendering — updated by onKeyDown (cycle),
   * onWillAppear, onDidReceiveSettings, and onGlobalSettingsChanged.
   */
  private displayMetric: AiGatewayMetricType = "requests";

  /** Tracks data-affecting settings so metric-only changes skip refetch. */
  private lastDataSettings: { gatewayId?: string; timeRange?: string } = {};

  /**
   * Set to `true` by onKeyDown before calling setSettings().
   * When onDidReceiveSettings fires as a result, it detects this flag,
   * skips re-rendering (onKeyDown already rendered), resets the flag.
   */
  private pendingKeyCycle = false;

  /** Stored event reference for re-initialization on global settings change. */
  private lastEvent: WillAppearEvent<AiGatewayMetricSettings> | DidReceiveSettingsEvent<AiGatewayMetricSettings> | null = null;

  /** Unsubscribe function for global settings listener. */
  private unsubscribeGlobal: (() => void) | null = null;

  /** Unsubscribe function for the polling coordinator. */
  private unsubscribeCoordinator: (() => void) | null = null;

  /** Marquee tick interval in milliseconds. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long gateway names. */
  private marquee = new MarqueeController(10);

  /** Interval handle for the marquee animation timer. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether the last fetch resulted in an error (for backoff). */
  private isErrorState = false;

  /** Timestamp until which coordinator ticks should be skipped (rate-limit/error). */
  private skipUntil = 0;

  /**
   * Called when the action appears on the Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<AiGatewayMetricSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();
    this.subscribeToCoordinator();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) {
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    this.apiClient = new CloudflareAiGatewayApi(global.apiToken!, global.accountId!);
    this.lastDataSettings = { gatewayId: settings.gatewayId, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "requests";
    this.marquee.setText(settings.gatewayId ?? "");

    // Show a loading state immediately while the API call is in flight
    await ev.action.setImage(
      renderKeyImage({
        line1: truncateGatewayName(settings.gatewayId ?? ""),
        line2: "...",
        line3: METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  /**
   * Called when settings are updated via the Property Inspector.
   *
   * Detects whether data-affecting settings (gatewayId, timeRange) changed.
   * If only the display metric changed, re-renders from cache instead of
   * doing a full API refetch — this prevents race conditions when the user
   * cycles metrics via key presses.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<AiGatewayMetricSettings>): Promise<void> {
    this.lastEvent = ev;

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastGatewayId = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastGatewayId = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const dataChanged =
      settings.gatewayId !== this.lastDataSettings.gatewayId ||
      settings.timeRange !== this.lastDataSettings.timeRange;

    // Key-press cycle: onKeyDown already rendered the new metric and
    // updated displayMetric — just schedule the next poll.
    if (this.pendingKeyCycle) {
      this.pendingKeyCycle = false;
      return;
    }

    // Update the authoritative display metric from settings
    this.displayMetric = settings.metric ?? "requests";

    // If only the display metric changed and we have cached data, re-render without refetching
    if (!dataChanged && this.lastMetrics && this.apiClient) {
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, this.lastGatewayId ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
      return;
    }

    // Data-affecting settings changed — full reset and refetch
    this.stopMarqueeTimer();
    this.apiClient = new CloudflareAiGatewayApi(global.apiToken!, global.accountId!);
    this.lastMetrics = null;
    this.lastGatewayId = null;
    this.lastDataSettings = { gatewayId: settings.gatewayId, timeRange: settings.timeRange };
    this.marquee.setText(settings.gatewayId ?? "");

    // Show loading state while fetching
    await ev.action.setImage(
      renderKeyImage({
        line1: truncateGatewayName(settings.gatewayId ?? ""),
        line2: "...",
        line3: METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override onWillDisappear(_ev: WillDisappearEvent<AiGatewayMetricSettings>): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastGatewayId = null;
    this.lastDataSettings = {};
    this.pendingKeyCycle = false;
    this.displayMetric = "requests";
    this.marquee.setText("");
    this.lastEvent = null;
    this.isErrorState = false;
    this.skipUntil = 0;
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
      this.unsubscribeGlobal = null;
    }
  }

  /**
   * Called when the key is pressed. Cycles to the next metric and re-renders
   * using cached data (no API call on press — metrics refresh on interval).
   */
  override async onKeyDown(ev: KeyDownEvent<AiGatewayMetricSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

    // Cycle to the next metric — read from displayMetric (authoritative),
    // not from the event payload which may be a stale snapshot.
    const currentMetric = this.displayMetric;
    const currentIndex = METRIC_CYCLE_ORDER.indexOf(currentMetric);
    const nextIndex = (currentIndex + 1) % METRIC_CYCLE_ORDER.length;
    const nextMetric = METRIC_CYCLE_ORDER[nextIndex];

    // Update the authoritative display metric FIRST
    this.displayMetric = nextMetric;

    // Re-render immediately with cached data if available
    if (this.lastMetrics) {
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, this.lastGatewayId ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
    }

    // Persist the new metric to settings (for PI sync and restart persistence).
    // This triggers onDidReceiveSettings — the pendingKeyCycle flag tells
    // it to only schedule the next poll without re-rendering.
    this.pendingKeyCycle = true;
    const newSettings: AiGatewayMetricSettings = { ...settings, metric: nextMetric };
    await ev.action.setSettings(newSettings);
    // If no cache, onDidReceiveSettings (triggered by setSettings) will handle the fetch
  }

  /**
   * Fetches metrics from the API and updates the key display.
   * Increments the fetch generation counter to prevent stale renders.
   */
  private async updateMetrics(
    ev: WillAppearEvent<AiGatewayMetricSettings>
      | KeyDownEvent<AiGatewayMetricSettings>
      | DidReceiveSettingsEvent<AiGatewayMetricSettings>,
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.gatewayId) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getMetrics(settings.gatewayId, timeRange);

      // Verify this fetch is still current
      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastGatewayId = settings.gatewayId;
      this.isErrorState = false;
      this.skipUntil = 0;

      // Always render using the authoritative displayMetric, not the
      // (potentially stale) event payload metric.
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, settings.gatewayId, metrics, timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
    } catch (error) {
      // If stale, silently abort — a newer cycle owns the display
      if (this.fetchGeneration !== gen) return;

      this.isErrorState = true;

      // Rate limit: use longer backoff from server hint if available
      if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
        this.skipUntil = Date.now() + error.retryAfterSeconds * 1000;
      } else {
        this.skipUntil = Date.now() + getPollingCoordinator().intervalMs * 2;
      }

      // If we have cached metrics, keep displaying them silently
      // (the coordinator will retry on the next tick)
      if (this.lastMetrics) {
        streamDeck.logger.debug(
          `Transient error for "${settings.gatewayId}", keeping cached display:`,
          error instanceof Error ? error.message : error
        );
        return;
      }

      // No cached data at all — show ERR to the user
      streamDeck.logger.error(
        `Failed to fetch AI Gateway metrics for "${settings.gatewayId}":`,
        error
      );
      await ev.action.setImage(
        renderKeyImage({
          line1: truncateGatewayName(settings.gatewayId),
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
    }
  }

  /**
   * Renders the key image for a given metric.
   *
   * Layout:
   *   Line 1: Gateway name (truncated)
   *   Line 2: Metric value (formatted)
   *   Line 3: Metric label + time range
   */
  public renderMetric(
    metric: AiGatewayMetricType,
    gatewayId: string,
    metrics: AiGatewayMetrics,
    timeRange?: string,
    displayName?: string,
  ): string {
    const name = displayName ?? truncateGatewayName(gatewayId);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);

    // logs_stored is not time-range dependent
    const rangeSuffix = metric === "logs_stored" ? "" : ` ${timeRange ?? "24h"}`;
    const label = `${METRIC_SHORT_LABELS[metric]}${rangeSuffix}`;

    return renderKeyImage({
      line1: name,
      line2: value,
      line3: label,
      statusColor: color,
    });
  }

  /**
   * Checks whether API credentials (apiToken + accountId) are present.
   */
  public hasCredentials(global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId);
  }

  /**
   * Checks whether all required settings (credentials + gateway ID) are present.
   */
  public hasRequiredSettings(settings: AiGatewayMetricSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.gatewayId);
  }

  /**
   * Subscribes to the shared polling coordinator so this action
   * receives periodic refresh ticks without managing its own timer.
   */
  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      "ai-gateway-metric",
      () => this.onCoordinatorTick(),
    );
  }

  /**
   * Called by the polling coordinator on each tick. Skips if
   * rate-limited or missing configuration.
   */
  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateMetrics(this.lastEvent);
  }

  /**
   * Starts the marquee animation interval if the gateway name is too
   * long for the key display. Only runs when data is available.
   */
  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastMetrics) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(() => this.onMarqueeTick(), AiGatewayMetric.MARQUEE_INTERVAL_MS);
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
    if (!changed || !this.lastMetrics || !this.lastEvent) return;

    const displayName = this.marquee.getCurrentText();
    const timeRange = this.lastEvent.payload.settings.timeRange ?? "24h";

    await this.lastEvent.action.setImage(
      this.renderMetric(this.displayMetric, this.lastGatewayId ?? "", this.lastMetrics, timeRange, displayName)
    );
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
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastGatewayId = null;
      this.lastDataSettings = {};

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      // Preserve the saved display metric from settings
      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.gatewayId ?? "");

      if (!this.hasCredentials(global)) {
        await ev.action.setImage(renderSetupImage());
        return;
      }

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareAiGatewayApi(global.apiToken!, global.accountId!);

      await this.updateMetrics(ev);
    });
  }
}
