/**
 * R2 Storage Metric action for Stream Deck.
 *
 * Displays R2 bucket storage metrics with metric cycling via key press.
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

import { CloudflareR2Api } from "../services/cloudflare-r2-api";
import { formatCompactNumber, RateLimitError } from "../services/cloudflare-ai-gateway-api";
import { formatBytes } from "../services/cloudflare-zone-analytics-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import type {
  R2MetricSettings,
  R2MetricType,
  R2Metrics,
} from "../types/cloudflare-r2";
import {
  R2_METRIC_CYCLE_ORDER,
  R2_METRIC_SHORT_LABELS,
} from "../types/cloudflare-r2";

/**
 * Truncates a bucket name for display.
 */
export function truncateBucketName(name: string): string {
  return truncateForDisplay(name, LINE1_MAX_CHARS);
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: R2MetricType): string {
  switch (metric) {
    case "objects":
      return STATUS_COLORS.blue;
    case "storage":
      return STATUS_COLORS.green;
    case "class_a_ops":
      return STATUS_COLORS.amber;
    case "class_b_ops":
      return STATUS_COLORS.blue;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(
  metric: R2MetricType,
  metrics: R2Metrics
): string {
  switch (metric) {
    case "objects":
      return formatCompactNumber(metrics.objectCount);
    case "storage":
      return formatBytes(metrics.payloadSize);
    case "class_a_ops":
      return formatCompactNumber(metrics.classAOps);
    case "class_b_ops":
      return formatCompactNumber(metrics.classBOps);
    default:
      return "N/A";
  }
}

@action({ UUID: "com.pedrofuentes.cloudflare-utilities.r2-storage-metric" })
export class R2StorageMetric extends SingletonAction<R2MetricSettings> {
  private apiClient: CloudflareR2Api | null = null;
  private fetchGeneration = 0;
  private lastMetrics: R2Metrics | null = null;
  private lastBucketName: string | null = null;
  private displayMetric: R2MetricType = "objects";
  private lastDataSettings: { bucketName?: string; timeRange?: string } = {};
  private pendingKeyCycle = false;
  private lastEvent: WillAppearEvent<R2MetricSettings> | DidReceiveSettingsEvent<R2MetricSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;
  private isErrorState = false;
  private skipUntil = 0;

  override async onWillAppear(ev: WillAppearEvent<R2MetricSettings>): Promise<void> {
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

    this.apiClient = new CloudflareR2Api(global.apiToken!, global.accountId!);
    this.lastDataSettings = { bucketName: settings.bucketName, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "objects";
    this.marquee.setText(settings.bucketName ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateBucketName(settings.bucketName ?? ""),
        line2: "...",
        line3: R2_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<R2MetricSettings>): Promise<void> {
    this.lastEvent = ev;

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastBucketName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastBucketName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const dataChanged =
      settings.bucketName !== this.lastDataSettings.bucketName ||
      settings.timeRange !== this.lastDataSettings.timeRange;

    if (this.pendingKeyCycle) {
      this.pendingKeyCycle = false;
      return;
    }

    this.displayMetric = settings.metric ?? "objects";

    if (!dataChanged && this.lastMetrics && this.apiClient) {
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, this.lastBucketName ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
      return;
    }

    this.stopMarqueeTimer();
    this.apiClient = new CloudflareR2Api(global.apiToken!, global.accountId!);
    this.lastMetrics = null;
    this.lastBucketName = null;
    this.lastDataSettings = { bucketName: settings.bucketName, timeRange: settings.timeRange };
    this.marquee.setText(settings.bucketName ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateBucketName(settings.bucketName ?? ""),
        line2: "...",
        line3: R2_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  override onWillDisappear(_ev: WillDisappearEvent<R2MetricSettings>): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastBucketName = null;
    this.lastDataSettings = {};
    this.pendingKeyCycle = false;
    this.displayMetric = "objects";
    this.marquee.setText("");
    this.lastEvent = null;
    this.isErrorState = false;
    this.skipUntil = 0;
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
      this.unsubscribeGlobal = null;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<R2MetricSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) return;

    const currentIndex = R2_METRIC_CYCLE_ORDER.indexOf(this.displayMetric);
    const nextIndex = (currentIndex + 1) % R2_METRIC_CYCLE_ORDER.length;
    const nextMetric = R2_METRIC_CYCLE_ORDER[nextIndex];

    this.displayMetric = nextMetric;

    if (this.lastMetrics) {
      await ev.action.setImage(
        this.renderMetric(this.displayMetric, this.lastBucketName ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText())
      );
      this.startMarqueeIfNeeded();
    }

    this.pendingKeyCycle = true;
    await ev.action.setSettings({ ...settings, metric: nextMetric });
  }

  private async updateMetrics(
    ev: WillAppearEvent<R2MetricSettings> | KeyDownEvent<R2MetricSettings> | DidReceiveSettingsEvent<R2MetricSettings>
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.bucketName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getMetrics(settings.bucketName, timeRange);
      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastBucketName = settings.bucketName;
      this.isErrorState = false;
      this.skipUntil = 0;

      await ev.action.setImage(
        this.renderMetric(this.displayMetric, settings.bucketName, metrics, timeRange, this.marquee.getCurrentText())
      );
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
        streamDeck.logger.debug(`Transient error for R2 bucket "${settings.bucketName}", keeping cached display:`, error instanceof Error ? error.message : error);
        return;
      }

      streamDeck.logger.error(`Failed to fetch R2 metrics for "${settings.bucketName}":`, error);
      await ev.action.setImage(renderKeyImage({ line1: truncateBucketName(settings.bucketName), line2: "ERR", statusColor: STATUS_COLORS.red }));
    }
  }

  public renderMetric(metric: R2MetricType, bucketName: string, metrics: R2Metrics, timeRange?: string, displayName?: string): string {
    const name = displayName ?? truncateBucketName(bucketName);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);
    const label = `${R2_METRIC_SHORT_LABELS[metric]} ${timeRange ?? "24h"}`;
    return renderKeyImage({ line1: name, line2: truncateForDisplay(value, LINE2_MAX_CHARS), line3: truncateForDisplay(label, LINE3_MAX_CHARS), statusColor: color });
  }

  public hasCredentials(global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId);
  }

  public hasRequiredSettings(settings: R2MetricSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.bucketName);
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe("r2-storage-metric", () => this.onCoordinatorTick());
  }

  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateMetrics(this.lastEvent);
  }

  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastMetrics) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(() => this.onMarqueeTick(), R2StorageMetric.MARQUEE_INTERVAL_MS);
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
    await this.lastEvent.action.setImage(this.renderMetric(this.displayMetric, this.lastBucketName ?? "", this.lastMetrics, timeRange, displayName));
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;
    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastBucketName = null;
      this.lastDataSettings = {};
      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();
      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.bucketName ?? "");
      if (!this.hasCredentials(global)) { await ev.action.setImage(renderSetupImage()); return; }
      if (!this.hasRequiredSettings(settings, global)) { await ev.action.setImage(renderPlaceholderImage()); return; }
      this.apiClient = new CloudflareR2Api(global.apiToken!, global.accountId!);
      await this.updateMetrics(ev);
    });
  }
}
