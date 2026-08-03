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
import { resolveAccountSelection } from "../services/account-selection";
import { formatCompactNumber, RateLimitError } from "../services/cloudflare-ai-gateway-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import { PerKeyHandlerRegistry } from "../services/per-key-handler-registry";
import { truncateWorkerName } from "../services/cloudflare-workers-api";
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
  private readonly keyHandlers: PerKeyHandlerRegistry<WorkerAnalytics> | null;
  private apiClient: CloudflareWorkerAnalyticsApi | null = null;

  constructor(isKeyHandler = false) {
    super();
    this.keyHandlers = isKeyHandler
      ? null
      : new PerKeyHandlerRegistry(() => new WorkerAnalytics(true));
  }

  /**
   * Fetch generation counter. Incremented before every fetch so stale
   * async completions can detect they are outdated and skip rendering.
   */
  private fetchGeneration = 0;

  /** Cached metrics for display on key press cycling. */
  private lastMetrics: WorkerAnalyticsMetrics | null = null;
  private lastWorkerName: string | null = null;

  /** Authoritative display metric — updated by cycle and settings. */
  private displayMetric: WorkerAnalyticsMetricType = "requests";

  /** Tracks data-affecting settings so metric-only changes skip refetch. */
  private lastDataSettings: { accountId?: string; workerName?: string; timeRange?: string } = {};

  /** Flag for key-press cycle — see AI Gateway Metric pattern. */
  private pendingKeyCycle = false;

  /** Stored event reference for re-initialization. */
  private lastEvent:
    | WillAppearEvent<WorkerAnalyticsSettings>
    | DidReceiveSettingsEvent<WorkerAnalyticsSettings>
    | null = null;

  /** Unsubscribe function for global settings listener. */
  private unsubscribeGlobal: (() => void) | null = null;

  /** Unsubscribe function for the polling coordinator. */
  private unsubscribeCoordinator: (() => void) | null = null;

  /** Marquee tick interval. */
  private static readonly MARQUEE_INTERVAL_MS = 500;

  /** Marquee controller for scrolling long worker names. */
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  /** Marquee animation interval handle. */
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether the last fetch errored. */
  private isErrorState = false;

  /** Timestamp until which coordinator ticks should be skipped (rate-limit/error). */
  private skipUntil = 0;

  /**
   * Called when the action appears on the Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<WorkerAnalyticsSettings>): Promise<void> {
    const keyHandler = this.keyHandlers?.get(ev.action.id);
    if (keyHandler) {
      await keyHandler.onWillAppear(ev);
      return;
    }
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();
    this.subscribeToCoordinator();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global, settings)) {
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const accountId = this.getAccountId(settings, global)!;
    this.apiClient = new CloudflareWorkerAnalyticsApi(global.apiToken!, accountId);
    this.lastDataSettings = { accountId, workerName: settings.workerName, timeRange: settings.timeRange };
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

    await this.updateMetrics(ev);
  }

  /**
   * Called when settings are updated via the Property Inspector.
   */
  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<WorkerAnalyticsSettings>
  ): Promise<void> {
    const keyHandler = this.keyHandlers?.get(ev.action.id);
    if (keyHandler) {
      await keyHandler.onDidReceiveSettings(ev);
      return;
    }
    this.fetchGeneration += 1;
    this.lastEvent = ev;

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global, settings)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastWorkerName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastWorkerName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const dataChanged =
      this.getAccountId(settings, global) !== this.lastDataSettings.accountId ||
      settings.workerName !== this.lastDataSettings.workerName ||
      settings.timeRange !== this.lastDataSettings.timeRange;

    if (this.pendingKeyCycle) {
      this.pendingKeyCycle = false;
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
      return;
    }

    this.stopMarqueeTimer();
    const accountId = this.getAccountId(settings, global)!;
    this.apiClient = new CloudflareWorkerAnalyticsApi(global.apiToken!, accountId);
    this.lastMetrics = null;
    this.lastWorkerName = null;
    this.lastDataSettings = { accountId, workerName: settings.workerName, timeRange: settings.timeRange };
    this.marquee.setText(settings.workerName ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateWorkerName(settings.workerName ?? ""),
        line2: "...",
        line3: WORKER_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override onWillDisappear(ev: WillDisappearEvent<WorkerAnalyticsSettings>): void {
    const keyHandler = this.keyHandlers?.take(ev.action.id);
    if (keyHandler) {
      keyHandler.onWillDisappear(ev);
      return;
    }
    this.fetchGeneration += 1;
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastWorkerName = null;
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
   * Called when the key is pressed. Cycles to the next metric.
   */
  override async onKeyDown(ev: KeyDownEvent<WorkerAnalyticsSettings>): Promise<void> {
    const keyHandler = this.keyHandlers?.get(ev.action.id);
    if (keyHandler) {
      await keyHandler.onKeyDown(ev);
      return;
    }
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

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
   * Increments the fetch generation counter to prevent stale renders.
   */
  private async updateMetrics(
    ev:
      | WillAppearEvent<WorkerAnalyticsSettings>
      | KeyDownEvent<WorkerAnalyticsSettings>
      | DidReceiveSettingsEvent<WorkerAnalyticsSettings>,
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.workerName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getAnalytics(settings.workerName, timeRange);

      // Verify this fetch is still current
      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastWorkerName = settings.workerName;
      this.isErrorState = false;
      this.skipUntil = 0;

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
      // If stale, silently abort — a newer cycle owns the display
      if (this.fetchGeneration !== gen) return;

      this.isErrorState = true;

      // Rate limit: use longer backoff from server hint if available
      if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
        this.skipUntil = Date.now() + error.retryAfterSeconds * 1000;
      } else {
        this.skipUntil = Date.now() + getPollingCoordinator().intervalMs * 2;
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
      line2: truncateForDisplay(value, LINE2_MAX_CHARS),
      line3: truncateForDisplay(label, LINE3_MAX_CHARS),
      statusColor: color,
    });
  }

  /**
   * Checks whether API credentials (apiToken + accountId) are present.
   */
  public hasCredentials(
    global?: { apiToken?: string; accountId?: string },
    settings?: WorkerAnalyticsSettings,
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && (settings?.accountId || g.accountId));
  }

  /**
   * Checks whether all required settings (credentials + worker name) are present.
   */
  public hasRequiredSettings(
    settings: WorkerAnalyticsSettings,
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && this.getAccountId(settings, g) && settings.workerName);
  }

  private getAccountId(settings: WorkerAnalyticsSettings, global: { accountId?: string }): string | undefined {
    return resolveAccountSelection(settings, global.accountId, !!settings.workerName)?.accountId;
  }

  /**
   * Subscribes to the shared polling coordinator so this action
   * receives periodic refresh ticks without managing its own timer.
   */
  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      `worker-analytics:${this.lastEvent?.action.id ?? "unknown"}`,
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

      if (!this.hasCredentials(global, settings)) {
        await ev.action.setImage(renderSetupImage());
        return;
      }

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareWorkerAnalyticsApi(
        global.apiToken!,
        this.getAccountId(settings, global)!
      );

      await this.updateMetrics(ev);
    });
  }
}
