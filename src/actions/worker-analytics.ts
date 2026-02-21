/**
 * Worker Analytics action for Stream Deck.
 *
 * Displays real-time invocation analytics for a Cloudflare Worker with
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
  CloudflareWorkerAnalyticsApi,
  formatDuration,
} from "../services/cloudflare-worker-analytics-api";
import { formatCompactNumber, RateLimitError } from "../services/cloudflare-ai-gateway-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, STATUS_COLORS } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import type {
  WorkerAnalyticsSettings,
  WorkerAnalyticsMetricType,
  WorkerAnalyticsMetrics,
} from "../types/cloudflare-worker-analytics";
import {
  WORKER_METRIC_CYCLE_ORDER,
  WORKER_METRIC_SHORT_LABELS,
} from "../types/cloudflare-worker-analytics";

/**
 * Truncates a worker name for display on a tiny OLED key.
 * Max 10 characters, appends "…" if truncated.
 */
export function truncateWorkerName(name: string): string {
  if (name.length <= 10) return name;
  return name.slice(0, 9) + "…";
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: WorkerAnalyticsMetricType): string {
  switch (metric) {
    case "requests":
      return STATUS_COLORS.blue;
    case "errors":
      return STATUS_COLORS.red;
    case "error_rate":
      return STATUS_COLORS.red;
    case "cpu_p50":
      return STATUS_COLORS.green;
    case "cpu_p99":
      return STATUS_COLORS.amber;
    case "wall_time":
      return STATUS_COLORS.blue;
    case "subrequests":
      return STATUS_COLORS.blue;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(
  metric: WorkerAnalyticsMetricType,
  metrics: WorkerAnalyticsMetrics
): string {
  switch (metric) {
    case "requests":
      return formatCompactNumber(metrics.requests);
    case "errors":
      return formatCompactNumber(metrics.errors);
    case "error_rate":
      if (metrics.requests === 0) return "0%";
      return `${((metrics.errors / metrics.requests) * 100).toFixed(1).replace(/\.0$/, "")}%`;
    case "cpu_p50":
      return formatDuration(metrics.cpuTimeP50);
    case "cpu_p99":
      return formatDuration(metrics.cpuTimeP99);
    case "wall_time":
      return formatDuration(metrics.wallTime);
    case "subrequests":
      return formatCompactNumber(metrics.subrequests);
    default:
      return "N/A";
  }
}

/**
 * Worker Analytics action — displays selected analytics metric from a
 * Cloudflare Worker script on a Stream Deck key.
 *
 * Pressing the key cycles through available metrics:
 *   Requests → Errors → Error Rate → CPU P50 → CPU P99 → Wall Time → Subrequests
 *
 * Color-coded accent bar:
 * - 🔵 Blue   → requests / wall time / subrequests
 * - 🟢 Green  → cpu p50
 * - 🟡 Amber  → cpu p99
 * - 🔴 Red    → errors / error rate
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.worker-analytics" })
export class WorkerAnalytics extends SingletonAction<WorkerAnalyticsSettings> {
  private apiClient: CloudflareWorkerAnalyticsApi | null = null;
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Generation counter — see AI Gateway Metric for pattern docs. */
  private refreshGeneration = 0;

  /** Cached metrics for display on key press cycling. */
  private lastMetrics: WorkerAnalyticsMetrics | null = null;
  private lastWorkerName: string | null = null;

  /** Authoritative display metric — updated by cycle and settings. */
  private displayMetric: WorkerAnalyticsMetricType = "requests";

  /** Tracks data-affecting settings so metric-only changes skip refetch. */
  private lastDataSettings: { workerName?: string; timeRange?: string } = {};

  /** Flag for key-press cycle — see AI Gateway Metric pattern. */
  private pendingKeyCycle = false;

  /** Stored event reference for re-initialization. */
  private lastEvent:
    | WillAppearEvent<WorkerAnalyticsSettings>
    | DidReceiveSettingsEvent<WorkerAnalyticsSettings>
    | null = null;

  /** Unsubscribe function for global settings listener. */
  private unsubscribeGlobal: (() => void) | null = null;

  /** Back-off after error (30 s). */
  private static readonly ERROR_BACKOFF_MS = 30 * 1000;
  /** Back-off after rate-limit (90 s). */
  private static readonly RATE_LIMIT_BACKOFF_MS = 90 * 1000;
  /** Marquee tick interval. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long worker names. */
  private marquee = new MarqueeController(10);
  /** Marquee animation interval handle. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether the last fetch errored (for adaptive polling). */
  private isErrorState = false;
  /** Server-hinted rate limit backoff ms. */
  private rateLimitBackoffMs = 0;

  /**
   * Called when the action appears on the Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<WorkerAnalyticsSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    this.apiClient = new CloudflareWorkerAnalyticsApi(global.apiToken!, global.accountId!);
    this.lastDataSettings = { workerName: settings.workerName, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "requests";
    this.marquee.setText(settings.workerName ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateWorkerName(settings.workerName ?? ""),
        line2: "...",
        line3: WORKER_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.fetchAndSchedule(ev);
  }

  /**
   * Called when settings are updated via the Property Inspector.
   */
  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<WorkerAnalyticsSettings>
  ): Promise<void> {
    this.lastEvent = ev;
    this.clearRefreshTimeout();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastWorkerName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const dataChanged =
      settings.workerName !== this.lastDataSettings.workerName ||
      settings.timeRange !== this.lastDataSettings.timeRange;

    if (this.pendingKeyCycle) {
      this.pendingKeyCycle = false;
      this.scheduleRefresh(ev);
      return;
    }

    this.displayMetric = settings.metric ?? "requests";

    if (!dataChanged && this.lastMetrics && this.apiClient) {
      await ev.action.setImage(
        this.renderMetric(
          this.displayMetric,
          this.lastWorkerName ?? "",
          this.lastMetrics,
          settings.timeRange,
          this.marquee.getCurrentText()
        )
      );
      this.startMarqueeIfNeeded();
      this.scheduleRefresh(ev);
      return;
    }

    this.stopMarqueeTimer();
    this.apiClient = new CloudflareWorkerAnalyticsApi(global.apiToken!, global.accountId!);
    this.lastMetrics = null;
    this.lastWorkerName = null;
    this.lastDataSettings = { workerName: settings.workerName, timeRange: settings.timeRange };
    this.marquee.setText(settings.workerName ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateWorkerName(settings.workerName ?? ""),
        line2: "...",
        line3: WORKER_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.fetchAndSchedule(ev);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override onWillDisappear(_ev: WillDisappearEvent<WorkerAnalyticsSettings>): void {
    this.clearRefreshTimeout();
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastWorkerName = null;
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
   * Called when the key is pressed. Cycles to the next metric.
   */
  override async onKeyDown(ev: KeyDownEvent<WorkerAnalyticsSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

    this.clearRefreshTimeout();

    const currentMetric = this.displayMetric;
    const currentIndex = WORKER_METRIC_CYCLE_ORDER.indexOf(currentMetric);
    const nextIndex = (currentIndex + 1) % WORKER_METRIC_CYCLE_ORDER.length;
    const nextMetric = WORKER_METRIC_CYCLE_ORDER[nextIndex];

    this.displayMetric = nextMetric;

    if (this.lastMetrics) {
      await ev.action.setImage(
        this.renderMetric(
          this.displayMetric,
          this.lastWorkerName ?? "",
          this.lastMetrics,
          settings.timeRange,
          this.marquee.getCurrentText()
        )
      );
      this.startMarqueeIfNeeded();
    }

    this.pendingKeyCycle = true;
    const newSettings: WorkerAnalyticsSettings = { ...settings, metric: nextMetric };
    await ev.action.setSettings(newSettings);
  }

  // ── Private Methods ──────────────────────────────────────────────────

  /**
   * Fetches metrics from the API and updates the key display.
   */
  private async updateMetrics(
    ev:
      | WillAppearEvent<WorkerAnalyticsSettings>
      | KeyDownEvent<WorkerAnalyticsSettings>
      | DidReceiveSettingsEvent<WorkerAnalyticsSettings>,
    generation?: number
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.workerName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getAnalytics(settings.workerName, timeRange);

      if (generation !== undefined && this.refreshGeneration !== generation) return;

      this.lastMetrics = metrics;
      this.lastWorkerName = settings.workerName;
      this.isErrorState = false;

      await ev.action.setImage(
        this.renderMetric(
          this.displayMetric,
          settings.workerName,
          metrics,
          timeRange,
          this.marquee.getCurrentText()
        )
      );
      this.startMarqueeIfNeeded();
    } catch (error) {
      if (generation !== undefined && this.refreshGeneration !== generation) return;

      this.isErrorState = true;

      if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
        this.rateLimitBackoffMs = error.retryAfterSeconds * 1000;
      } else {
        this.rateLimitBackoffMs = 0;
      }

      if (this.lastMetrics) {
        streamDeck.logger.debug(
          `Transient error for "${settings.workerName}", keeping cached display:`,
          error instanceof Error ? error.message : error
        );
        return;
      }

      streamDeck.logger.error(
        `Failed to fetch Worker analytics for "${settings.workerName}":`,
        error
      );
      await ev.action.setImage(
        renderKeyImage({
          line1: truncateWorkerName(settings.workerName),
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
    }
  }

  /**
   * Renders the key image for a given metric.
   */
  public renderMetric(
    metric: WorkerAnalyticsMetricType,
    workerName: string,
    metrics: WorkerAnalyticsMetrics,
    timeRange?: string,
    displayName?: string
  ): string {
    const name = displayName ?? truncateWorkerName(workerName);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);
    const rangeSuffix = ` ${timeRange ?? "24h"}`;
    const label = `${WORKER_METRIC_SHORT_LABELS[metric]}${rangeSuffix}`;

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
  public hasRequiredSettings(
    settings: WorkerAnalyticsSettings,
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.workerName);
  }

  /**
   * Returns the polling interval in ms. Uses back-off after errors.
   */
  public getPollingInterval(baseIntervalSeconds: number): number {
    if (this.isErrorState) {
      if (this.rateLimitBackoffMs > 0) {
        return this.rateLimitBackoffMs;
      }
      return WorkerAnalytics.RATE_LIMIT_BACKOFF_MS;
    }
    return baseIntervalSeconds * 1000;
  }

  private async fetchAndSchedule(
    ev:
      | WillAppearEvent<WorkerAnalyticsSettings>
      | DidReceiveSettingsEvent<WorkerAnalyticsSettings>
  ): Promise<void> {
    this.clearRefreshTimeout();
    const gen = ++this.refreshGeneration;

    await this.updateMetrics(ev, gen);

    if (this.refreshGeneration !== gen) return;
    this.scheduleRefresh(ev);
  }

  private scheduleRefresh(
    ev:
      | WillAppearEvent<WorkerAnalyticsSettings>
      | DidReceiveSettingsEvent<WorkerAnalyticsSettings>
  ): void {
    this.clearRefreshTimeout();

    const gen = ++this.refreshGeneration;
    const baseSeconds = ev.payload.settings.refreshIntervalSeconds ?? 60;
    const delayMs = this.getPollingInterval(baseSeconds);

    this.refreshTimeout = setTimeout(async () => {
      if (this.refreshGeneration !== gen) return;
      await this.updateMetrics(ev, gen);
      if (this.refreshGeneration !== gen) return;
      this.scheduleRefresh(ev);
    }, delayMs);
  }

  private clearRefreshTimeout(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastMetrics) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(
          () => this.onMarqueeTick(),
          WorkerAnalytics.MARQUEE_INTERVAL_MS
        );
      }
    } else {
      this.stopMarqueeTimer();
    }
  }

  private stopMarqueeTimer(): void {
    if (this.marqueeInterval) {
      clearInterval(this.marqueeInterval);
      this.marqueeInterval = null;
    }
  }

  private async onMarqueeTick(): Promise<void> {
    const changed = this.marquee.tick();
    if (!changed || !this.lastMetrics || !this.lastEvent) return;

    const displayName = this.marquee.getCurrentText();
    const timeRange = this.lastEvent.payload.settings.timeRange ?? "24h";

    await this.lastEvent.action.setImage(
      this.renderMetric(
        this.displayMetric,
        this.lastWorkerName ?? "",
        this.lastMetrics,
        timeRange,
        displayName
      )
    );
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;

    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;

      this.clearRefreshTimeout();
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastWorkerName = null;
      this.lastDataSettings = {};

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.workerName ?? "");

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareWorkerAnalyticsApi(
        global.apiToken!,
        global.accountId!
      );

      await this.fetchAndSchedule(ev);
    });
  }
}
