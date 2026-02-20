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
import { renderKeyImage, renderPlaceholderImage, STATUS_COLORS } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
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
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Generation counter for refresh cycles. Incremented on every
   * `scheduleRefresh` call so that in-flight timer callbacks from a
   * previous cycle can detect they are stale and abort, preventing
   * zombie timer chains that render the wrong metric.
   */
  private refreshGeneration = 0;

  /** Cached metrics for display on key press cycling (avoids re-fetch). */
  private lastMetrics: AiGatewayMetrics | null = null;
  private lastGatewayId: string | null = null;

  /**
   * The metric currently shown on the key. This is the authoritative
   * source of truth for rendering — updated by onKeyDown (cycle),
   * onWillAppear, onDidReceiveSettings, and onGlobalSettingsChanged.
   * Using an instance variable avoids stale event payloads in timer
   * closures from reverting the display after a key-press cycle.
   */
  private displayMetric: AiGatewayMetricType = "requests";

  /** Tracks data-affecting settings so metric-only changes skip refetch. */
  private lastDataSettings: { gatewayId?: string; timeRange?: string } = {};

  /**
   * Set to `true` by onKeyDown before calling setSettings().
   * When onDidReceiveSettings fires as a result, it detects this flag,
   * skips re-rendering (onKeyDown already rendered), but still schedules
   * the next refresh timer. Cleared immediately upon consumption.
   */
  private pendingKeyCycle = false;

  /** Stored event reference for re-initialization on global settings change. */
  private lastEvent: WillAppearEvent<AiGatewayMetricSettings> | DidReceiveSettingsEvent<AiGatewayMetricSettings> | null = null;

  /** Unsubscribe function for global settings listener. */
  private unsubscribeGlobal: (() => void) | null = null;

  /** Back-off interval after an error (30 s). */
  private static readonly ERROR_BACKOFF_MS = 30 * 1000;

  /** Back-off interval after rate limiting (90 s). */
  private static readonly RATE_LIMIT_BACKOFF_MS = 90 * 1000;

  /** Marquee tick interval in milliseconds. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long gateway names. */
  private marquee = new MarqueeController(10);

  /** Interval handle for the marquee animation timer. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Called when the action appears on the Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<AiGatewayMetricSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

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

    await this.fetchAndSchedule(ev);
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
    this.clearRefreshTimeout();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

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
      this.scheduleRefresh(ev);
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
      this.scheduleRefresh(ev);
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

    await this.fetchAndSchedule(ev);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override onWillDisappear(_ev: WillDisappearEvent<AiGatewayMetricSettings>): void {
    this.clearRefreshTimeout();
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastGatewayId = null;
    this.lastDataSettings = {};
    this.pendingKeyCycle = false;
    this.displayMetric = "requests";
    this.marquee.setText("");
    this.lastEvent = null;
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

    // Stop the current refresh timer immediately to prevent stale renders
    this.clearRefreshTimeout();

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
   *
   * @param ev - The triggering event (provides settings and action ref)
   * @param generation - Optional refresh generation. When provided (from timer
   *   callbacks), the method checks whether this generation is still current
   *   after the async fetch returns. If a newer cycle has started, it aborts
   *   without rendering, preventing stale data from overwriting the display.
   */
  private async updateMetrics(
    ev: WillAppearEvent<AiGatewayMetricSettings>
      | KeyDownEvent<AiGatewayMetricSettings>
      | DidReceiveSettingsEvent<AiGatewayMetricSettings>,
    generation?: number
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.gatewayId) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getMetrics(settings.gatewayId, timeRange);

      // If a generation was provided, verify this fetch is still current
      if (generation !== undefined && this.refreshGeneration !== generation) return;

      this.lastMetrics = metrics;
      this.lastGatewayId = settings.gatewayId;
      this.isErrorState = false;

      // Always render using the authoritative displayMetric, not the
      // (potentially stale) event payload metric.
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, settings.gatewayId, metrics, timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
    } catch (error) {
      // If stale, silently abort — a newer cycle owns the display
      if (generation !== undefined && this.refreshGeneration !== generation) return;

      this.isErrorState = true;

      // Rate limit: use longer backoff from server hint if available
      if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
        this.rateLimitBackoffMs = error.retryAfterSeconds * 1000;
      } else {
        this.rateLimitBackoffMs = 0;
      }

      // If we have cached metrics, keep displaying them silently
      // (the polling timer will retry with backoff)
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

  /** Whether the last fetch resulted in an error (for adaptive polling). */
  private isErrorState = false;

  /** Server-hinted rate limit backoff in ms (0 = not rate-limited). */
  private rateLimitBackoffMs = 0;

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
   * Checks whether the required settings are present.
   */
  public hasRequiredSettings(settings: AiGatewayMetricSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.gatewayId);
  }

  /**
   * Returns the polling interval in ms. Uses back-off after errors.
   */
  public getPollingInterval(baseIntervalSeconds: number): number {
    if (this.isErrorState) {
      // Use server-hinted rate limit backoff, or fixed rate-limit backoff,
      // or generic error backoff
      if (this.rateLimitBackoffMs > 0) {
        return this.rateLimitBackoffMs;
      }
      return AiGatewayMetric.RATE_LIMIT_BACKOFF_MS;
    }
    return baseIntervalSeconds * 1000;
  }

  /**
   * Starts a new fetch cycle: increments the generation, fetches metrics,
   * and schedules the next poll. If a newer cycle starts while this one
   * is awaiting the fetch, this cycle detects it and aborts.
   *
   * Every entry point that triggers a fetch (onWillAppear,
   * onDidReceiveSettings, onGlobalSettingsChanged) MUST go through
   * this method to prevent concurrent timer chains.
   */
  private async fetchAndSchedule(
    ev: WillAppearEvent<AiGatewayMetricSettings> | DidReceiveSettingsEvent<AiGatewayMetricSettings>
  ): Promise<void> {
    this.clearRefreshTimeout();
    const gen = ++this.refreshGeneration;

    await this.updateMetrics(ev, gen);

    // If a newer cycle started while we were awaiting, don't schedule
    if (this.refreshGeneration !== gen) return;
    this.scheduleRefresh(ev);
  }

  /**
   * Schedules the next poll using setTimeout.
   *
   * Each call increments `refreshGeneration`. The timer callback
   * captures its generation and aborts if a newer cycle has started,
   * which prevents stale callbacks (whose fetch was in-flight when
   * the user cycled metrics) from hijacking the timer chain.
   */
  private scheduleRefresh(
    ev: WillAppearEvent<AiGatewayMetricSettings> | DidReceiveSettingsEvent<AiGatewayMetricSettings>
  ): void {
    this.clearRefreshTimeout();

    const gen = ++this.refreshGeneration;
    const baseSeconds = ev.payload.settings.refreshIntervalSeconds ?? 60;
    const delayMs = this.getPollingInterval(baseSeconds);

    this.refreshTimeout = setTimeout(async () => {
      if (this.refreshGeneration !== gen) return; // stale — a newer cycle owns the timer
      await this.updateMetrics(ev, gen);
      if (this.refreshGeneration !== gen) return; // stale after async fetch
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
      this.clearRefreshTimeout();
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

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareAiGatewayApi(global.apiToken!, global.accountId!);

      await this.fetchAndSchedule(ev);
    });
  }
}
