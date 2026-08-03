/**
 * D1 Database Metric action for Stream Deck.
 *
 * Displays D1 database analytics with metric cycling via key press.
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

import { CloudflareD1Api } from "../services/cloudflare-d1-api";
import { resolveAccountSelection } from "../services/account-selection";
import { formatCompactNumber, RateLimitError } from "../services/cloudflare-ai-gateway-api";
import { formatBytes } from "../services/cloudflare-zone-analytics-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import { PerKeyHandlerRegistry } from "../services/per-key-handler-registry";
import type {
  D1MetricSettings,
  D1MetricType,
  D1Metrics,
} from "../types/cloudflare-d1";
import {
  D1_METRIC_CYCLE_ORDER,
  D1_METRIC_SHORT_LABELS,
} from "../types/cloudflare-d1";

/**
 * Truncates a database name for display.
 */
export function truncateDbName(name: string): string {
  return truncateForDisplay(name, LINE1_MAX_CHARS);
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: D1MetricType): string {
  switch (metric) {
    case "reads":
      return STATUS_COLORS.blue;
    case "writes":
      return STATUS_COLORS.amber;
    case "rows_read":
      return STATUS_COLORS.blue;
    case "rows_written":
      return STATUS_COLORS.amber;
    case "db_size":
      return STATUS_COLORS.green;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(
  metric: D1MetricType,
  metrics: D1Metrics
): string {
  switch (metric) {
    case "reads":
      return formatCompactNumber(metrics.readQueries);
    case "writes":
      return formatCompactNumber(metrics.writeQueries);
    case "rows_read":
      return formatCompactNumber(metrics.rowsRead);
    case "rows_written":
      return formatCompactNumber(metrics.rowsWritten);
    case "db_size":
      return formatBytes(metrics.databaseSizeBytes);
    default:
      return "N/A";
  }
}

@action({ UUID: "com.pedrofuentes.cloudflare-utilities.d1-database-metric" })
export class D1DatabaseMetric extends SingletonAction<D1MetricSettings> {
  private readonly keyHandlers: PerKeyHandlerRegistry<D1DatabaseMetric> | null;
  private apiClient: CloudflareD1Api | null = null;

  constructor(isKeyHandler = false) {
    super();
    this.keyHandlers = isKeyHandler
      ? null
      : new PerKeyHandlerRegistry(() => new D1DatabaseMetric(true));
  }
  private fetchGeneration = 0;
  private lastMetrics: D1Metrics | null = null;
  private lastDbId: string | null = null;
  private lastDbName: string | null = null;
  private displayMetric: D1MetricType = "reads";
  private lastDataSettings: { accountId?: string; databaseId?: string; timeRange?: string } = {};
  private pendingKeyCycle = false;
  private lastEvent: WillAppearEvent<D1MetricSettings> | DidReceiveSettingsEvent<D1MetricSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;
  private isErrorState = false;
  private skipUntil = 0;

  override async onWillAppear(ev: WillAppearEvent<D1MetricSettings>): Promise<void> {
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

    if (!this.hasCredentials(global, settings)) { await ev.action.setImage(renderSetupImage()); return; }
    if (!this.hasRequiredSettings(settings, global)) { await ev.action.setImage(renderPlaceholderImage()); return; }

    const accountId = this.getAccountId(settings, global)!;
    this.apiClient = new CloudflareD1Api(global.apiToken!, accountId);
    this.lastDataSettings = { accountId, databaseId: settings.databaseId, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "reads";
    this.marquee.setText(settings.databaseName ?? settings.databaseId ?? "");

    await ev.action.setImage(renderKeyImage({
      line1: truncateDbName(settings.databaseName ?? settings.databaseId ?? ""),
      line2: "...",
      line3: D1_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
      statusColor: metricColor(this.displayMetric),
    }));

    await this.updateMetrics(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<D1MetricSettings>): Promise<void> {
    const keyHandler = this.keyHandlers?.get(ev.action.id);
    if (keyHandler) {
      await keyHandler.onDidReceiveSettings(ev);
      return;
    }
    this.fetchGeneration += 1;
    this.lastEvent = ev;
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global, settings)) { this.apiClient = null; this.lastMetrics = null; this.lastDbId = null; this.lastDbName = null; this.lastDataSettings = {}; await ev.action.setImage(renderSetupImage()); return; }
    if (!this.hasRequiredSettings(settings, global)) { this.apiClient = null; this.lastMetrics = null; this.lastDbId = null; this.lastDbName = null; this.lastDataSettings = {}; await ev.action.setImage(renderPlaceholderImage()); return; }

    const dataChanged = this.getAccountId(settings, global) !== this.lastDataSettings.accountId || settings.databaseId !== this.lastDataSettings.databaseId || settings.timeRange !== this.lastDataSettings.timeRange;

    if (this.pendingKeyCycle) { this.pendingKeyCycle = false; return; }

    this.displayMetric = settings.metric ?? "reads";

    if (!dataChanged && this.lastMetrics && this.apiClient) {
      await ev.action.setImage(this.renderMetric(this.displayMetric, this.lastDbName ?? this.lastDbId ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText()));
      this.startMarqueeIfNeeded();
      return;
    }

    this.stopMarqueeTimer();
    const accountId = this.getAccountId(settings, global)!;
    this.apiClient = new CloudflareD1Api(global.apiToken!, accountId);
    this.lastMetrics = null;
    this.lastDbId = null;
    this.lastDbName = null;
    this.lastDataSettings = { accountId, databaseId: settings.databaseId, timeRange: settings.timeRange };
    this.marquee.setText(settings.databaseName ?? settings.databaseId ?? "");

    await ev.action.setImage(renderKeyImage({
      line1: truncateDbName(settings.databaseName ?? settings.databaseId ?? ""),
      line2: "...",
      line3: D1_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
      statusColor: metricColor(this.displayMetric),
    }));

    await this.updateMetrics(ev);
  }

  override onWillDisappear(ev: WillDisappearEvent<D1MetricSettings>): void {
    const keyHandler = this.keyHandlers?.take(ev.action.id);
    if (keyHandler) {
      keyHandler.onWillDisappear(ev);
      return;
    }
    this.fetchGeneration += 1;
    if (this.unsubscribeCoordinator) { this.unsubscribeCoordinator(); this.unsubscribeCoordinator = null; }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastDbId = null;
    this.lastDbName = null;
    this.lastDataSettings = {};
    this.pendingKeyCycle = false;
    this.displayMetric = "reads";
    this.marquee.setText("");
    this.lastEvent = null;
    this.isErrorState = false;
    this.skipUntil = 0;
    if (this.unsubscribeGlobal) { this.unsubscribeGlobal(); this.unsubscribeGlobal = null; }
  }

  override async onKeyDown(ev: KeyDownEvent<D1MetricSettings>): Promise<void> {
    const keyHandler = this.keyHandlers?.get(ev.action.id);
    if (keyHandler) {
      await keyHandler.onKeyDown(ev);
      return;
    }
    const settings = ev.payload.settings;
    const global = getGlobalSettings();
    if (!this.hasRequiredSettings(settings, global)) return;

    const currentIndex = D1_METRIC_CYCLE_ORDER.indexOf(this.displayMetric);
    const nextIndex = (currentIndex + 1) % D1_METRIC_CYCLE_ORDER.length;
    const nextMetric = D1_METRIC_CYCLE_ORDER[nextIndex];

    this.displayMetric = nextMetric;

    if (this.lastMetrics) {
      await ev.action.setImage(this.renderMetric(this.displayMetric, this.lastDbName ?? this.lastDbId ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText()));
      this.startMarqueeIfNeeded();
    }

    this.pendingKeyCycle = true;
    await ev.action.setSettings({ ...settings, metric: nextMetric });
  }

  private async updateMetrics(
    ev: WillAppearEvent<D1MetricSettings> | KeyDownEvent<D1MetricSettings> | DidReceiveSettingsEvent<D1MetricSettings>
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;
    if (!this.apiClient || !settings.databaseId) { await ev.action.setImage(renderPlaceholderImage()); return; }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getAnalytics(settings.databaseId, timeRange);
      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastDbId = settings.databaseId;
      this.lastDbName = settings.databaseName ?? settings.databaseId;
      this.isErrorState = false;
      this.skipUntil = 0;

      await ev.action.setImage(this.renderMetric(this.displayMetric, settings.databaseName ?? settings.databaseId ?? "", metrics, timeRange, this.marquee.getCurrentText()));
      this.startMarqueeIfNeeded();
    } catch (error) {
      if (this.fetchGeneration !== gen) return;
      this.isErrorState = true;

      if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
        this.skipUntil = Date.now() + error.retryAfterSeconds * 1000;
      } else {
        this.skipUntil = Date.now() + getPollingCoordinator().intervalMs * 2;
      }

      if (this.lastMetrics) {
        streamDeck.logger.debug(`Transient error for D1 "${settings.databaseId}", keeping cached:`, error instanceof Error ? error.message : error);
        return;
      }

      streamDeck.logger.error(`Failed to fetch D1 metrics for "${settings.databaseId}":`, error);
      await ev.action.setImage(renderKeyImage({ line1: truncateDbName(settings.databaseName ?? settings.databaseId ?? ""), line2: "ERR", statusColor: STATUS_COLORS.red }));
    }
  }

  public renderMetric(metric: D1MetricType, dbName: string, metrics: D1Metrics, timeRange?: string, displayName?: string): string {
    const name = displayName ?? truncateDbName(dbName);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);
    // db_size is a point-in-time value, not a time-range aggregate
    const rangeSuffix = metric === "db_size" ? "" : ` ${timeRange ?? "24h"}`;
    const label = `${D1_METRIC_SHORT_LABELS[metric]}${rangeSuffix}`;
    return renderKeyImage({ line1: name, line2: truncateForDisplay(value, LINE2_MAX_CHARS), line3: truncateForDisplay(label, LINE3_MAX_CHARS), statusColor: color });
  }

  public hasCredentials(global?: { apiToken?: string; accountId?: string }, settings?: D1MetricSettings): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && (settings?.accountId || g.accountId));
  }

  public hasRequiredSettings(settings: D1MetricSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && this.getAccountId(settings, g) && settings.databaseId);
  }

  private getAccountId(settings: D1MetricSettings, global: { accountId?: string }): string | undefined {
    return resolveAccountSelection(settings, global.accountId, !!settings.databaseId)?.accountId;
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(`d1-database-metric:${this.lastEvent?.action.id ?? "unknown"}`, () => this.onCoordinatorTick());
  }

  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateMetrics(this.lastEvent);
  }

  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastMetrics) {
      if (!this.marqueeInterval) this.marqueeInterval = setInterval(() => this.onMarqueeTick(), D1DatabaseMetric.MARQUEE_INTERVAL_MS);
    } else { this.stopMarqueeTimer(); }
  }

  private stopMarqueeTimer(): void {
    if (this.marqueeInterval) { clearInterval(this.marqueeInterval); this.marqueeInterval = null; }
  }

  private async onMarqueeTick(): Promise<void> {
    const changed = this.marquee.tick();
    if (!changed || !this.lastMetrics || !this.lastEvent) return;
    const displayName = this.marquee.getCurrentText();
    const timeRange = this.lastEvent.payload.settings.timeRange ?? "24h";
    await this.lastEvent.action.setImage(this.renderMetric(this.displayMetric, this.lastDbId ?? "", this.lastMetrics, timeRange, displayName));
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;
    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastDbId = null;
      this.lastDbName = null;
      this.lastDataSettings = {};
      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();
      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.databaseName ?? settings.databaseId ?? "");
      if (!this.hasCredentials(global, settings)) { await ev.action.setImage(renderSetupImage()); return; }
      if (!this.hasRequiredSettings(settings, global)) { await ev.action.setImage(renderPlaceholderImage()); return; }
      const accountId = this.getAccountId(settings, global)!;
      this.apiClient = new CloudflareD1Api(global.apiToken!, accountId);
      await this.updateMetrics(ev);
    });
  }
}
