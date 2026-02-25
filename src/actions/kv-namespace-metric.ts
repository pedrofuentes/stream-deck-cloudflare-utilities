/**
 * KV Namespace Metric action for Stream Deck.
 *
 * Displays Workers KV namespace analytics with metric cycling via key press.
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

import { CloudflareKvApi } from "../services/cloudflare-kv-api";
import { formatCompactNumber, RateLimitError } from "../services/cloudflare-ai-gateway-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import type {
  KvMetricSettings,
  KvMetricType,
  KvMetrics,
} from "../types/cloudflare-kv";
import {
  KV_METRIC_CYCLE_ORDER,
  KV_METRIC_SHORT_LABELS,
} from "../types/cloudflare-kv";

/**
 * Truncates a namespace title for display.
 */
export function truncateNamespaceName(name: string): string {
  return truncateForDisplay(name, LINE1_MAX_CHARS);
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: KvMetricType): string {
  switch (metric) {
    case "reads":
      return STATUS_COLORS.blue;
    case "writes":
      return STATUS_COLORS.amber;
    case "deletes":
      return STATUS_COLORS.red;
    case "lists":
      return STATUS_COLORS.green;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(
  metric: KvMetricType,
  metrics: KvMetrics
): string {
  switch (metric) {
    case "reads":
      return formatCompactNumber(metrics.readQueries);
    case "writes":
      return formatCompactNumber(metrics.writeQueries);
    case "deletes":
      return formatCompactNumber(metrics.deleteQueries);
    case "lists":
      return formatCompactNumber(metrics.listQueries);
    default:
      return "N/A";
  }
}

@action({ UUID: "com.pedrofuentes.cloudflare-utilities.kv-namespace-metric" })
export class KvNamespaceMetric extends SingletonAction<KvMetricSettings> {
  private apiClient: CloudflareKvApi | null = null;
  private fetchGeneration = 0;
  private lastMetrics: KvMetrics | null = null;
  private lastNamespaceId: string | null = null;
  private displayMetric: KvMetricType = "reads";
  private lastDataSettings: { namespaceId?: string; timeRange?: string } = {};
  private pendingKeyCycle = false;
  private lastEvent: WillAppearEvent<KvMetricSettings> | DidReceiveSettingsEvent<KvMetricSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;
  private isErrorState = false;
  private skipUntil = 0;

  override async onWillAppear(ev: WillAppearEvent<KvMetricSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();
    this.subscribeToCoordinator();

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) { await ev.action.setImage(renderSetupImage()); return; }
    if (!this.hasRequiredSettings(settings, global)) { await ev.action.setImage(renderPlaceholderImage()); return; }

    this.apiClient = new CloudflareKvApi(global.apiToken!, global.accountId!);
    this.lastDataSettings = { namespaceId: settings.namespaceId, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "reads";
    this.marquee.setText(settings.namespaceName ?? settings.namespaceId ?? "");

    await ev.action.setImage(renderKeyImage({
      line1: truncateNamespaceName(settings.namespaceName ?? settings.namespaceId ?? ""),
      line2: "...",
      line3: KV_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
      statusColor: metricColor(this.displayMetric),
    }));

    await this.updateMetrics(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<KvMetricSettings>): Promise<void> {
    this.lastEvent = ev;
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) { this.apiClient = null; this.lastMetrics = null; this.lastNamespaceId = null; this.lastDataSettings = {}; await ev.action.setImage(renderSetupImage()); return; }
    if (!this.hasRequiredSettings(settings, global)) { this.apiClient = null; this.lastMetrics = null; this.lastNamespaceId = null; this.lastDataSettings = {}; await ev.action.setImage(renderPlaceholderImage()); return; }

    const dataChanged = settings.namespaceId !== this.lastDataSettings.namespaceId || settings.timeRange !== this.lastDataSettings.timeRange;

    if (this.pendingKeyCycle) { this.pendingKeyCycle = false; return; }

    this.displayMetric = settings.metric ?? "reads";

    if (!dataChanged && this.lastMetrics && this.apiClient) {
      this.marquee.setText(settings.namespaceName ?? settings.namespaceId ?? "");
      await ev.action.setImage(this.renderMetric(this.displayMetric, settings.namespaceName ?? settings.namespaceId ?? "", this.lastMetrics, settings.timeRange, this.marquee.getCurrentText()));
      this.startMarqueeIfNeeded();
      return;
    }

    this.stopMarqueeTimer();
    this.apiClient = new CloudflareKvApi(global.apiToken!, global.accountId!);
    this.lastMetrics = null;
    this.lastNamespaceId = null;
    this.lastDataSettings = { namespaceId: settings.namespaceId, timeRange: settings.timeRange };
    this.marquee.setText(settings.namespaceName ?? settings.namespaceId ?? "");

    await ev.action.setImage(renderKeyImage({
      line1: truncateNamespaceName(settings.namespaceName ?? settings.namespaceId ?? ""),
      line2: "...",
      line3: KV_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
      statusColor: metricColor(this.displayMetric),
    }));

    await this.updateMetrics(ev);
  }

  override onWillDisappear(_ev: WillDisappearEvent<KvMetricSettings>): void {
    if (this.unsubscribeCoordinator) { this.unsubscribeCoordinator(); this.unsubscribeCoordinator = null; }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastNamespaceId = null;
    this.lastDataSettings = {};
    this.pendingKeyCycle = false;
    this.displayMetric = "reads";
    this.marquee.setText("");
    this.lastEvent = null;
    this.isErrorState = false;
    this.skipUntil = 0;
    if (this.unsubscribeGlobal) { this.unsubscribeGlobal(); this.unsubscribeGlobal = null; }
  }

  override async onKeyDown(ev: KeyDownEvent<KvMetricSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();
    if (!this.hasRequiredSettings(settings, global)) return;

    const currentIndex = KV_METRIC_CYCLE_ORDER.indexOf(this.displayMetric);
    const nextIndex = (currentIndex + 1) % KV_METRIC_CYCLE_ORDER.length;
    const nextMetric = KV_METRIC_CYCLE_ORDER[nextIndex];

    this.displayMetric = nextMetric;

    if (this.lastMetrics) {
      const displayName = settings.namespaceName ?? settings.namespaceId ?? "";
      await ev.action.setImage(this.renderMetric(this.displayMetric, displayName, this.lastMetrics, settings.timeRange, this.marquee.getCurrentText()));
      this.startMarqueeIfNeeded();
    }

    this.pendingKeyCycle = true;
    await ev.action.setSettings({ ...settings, metric: nextMetric });
  }

  private async updateMetrics(
    ev: WillAppearEvent<KvMetricSettings> | KeyDownEvent<KvMetricSettings> | DidReceiveSettingsEvent<KvMetricSettings>
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;
    if (!this.apiClient || !settings.namespaceId) { await ev.action.setImage(renderPlaceholderImage()); return; }

    const timeRange = settings.timeRange ?? "24h";
    const displayName = settings.namespaceName ?? settings.namespaceId;

    try {
      const metrics = await this.apiClient.getAnalytics(settings.namespaceId, timeRange);
      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastNamespaceId = settings.namespaceId;
      this.isErrorState = false;
      this.skipUntil = 0;

      await ev.action.setImage(this.renderMetric(this.displayMetric, displayName, metrics, timeRange, this.marquee.getCurrentText()));
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
        streamDeck.logger.debug(`Transient error for KV "${displayName}", keeping cached:`, error instanceof Error ? error.message : error);
        return;
      }

      streamDeck.logger.error(`Failed to fetch KV metrics for "${displayName}":`, error);
      await ev.action.setImage(renderKeyImage({ line1: truncateNamespaceName(displayName), line2: "ERR", statusColor: STATUS_COLORS.red }));
    }
  }

  public renderMetric(metric: KvMetricType, namespaceName: string, metrics: KvMetrics, timeRange?: string, displayName?: string): string {
    const name = displayName ?? truncateNamespaceName(namespaceName);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);
    const label = `${KV_METRIC_SHORT_LABELS[metric]} ${timeRange ?? "24h"}`;
    return renderKeyImage({ line1: name, line2: truncateForDisplay(value, LINE2_MAX_CHARS), line3: truncateForDisplay(label, LINE3_MAX_CHARS), statusColor: color });
  }

  public hasCredentials(global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId);
  }

  public hasRequiredSettings(settings: KvMetricSettings, global?: { apiToken?: string; accountId?: string }): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.namespaceId);
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe("kv-namespace-metric", () => this.onCoordinatorTick());
  }

  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateMetrics(this.lastEvent);
  }

  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation() && this.lastMetrics) {
      if (!this.marqueeInterval) this.marqueeInterval = setInterval(() => this.onMarqueeTick(), KvNamespaceMetric.MARQUEE_INTERVAL_MS);
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
    const namespaceName = this.lastEvent.payload.settings.namespaceName ?? this.lastEvent.payload.settings.namespaceId ?? "";
    await this.lastEvent.action.setImage(this.renderMetric(this.displayMetric, namespaceName, this.lastMetrics, timeRange, displayName));
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;
    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastNamespaceId = null;
      this.lastDataSettings = {};
      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();
      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.namespaceName ?? settings.namespaceId ?? "");
      if (!this.hasCredentials(global)) { await ev.action.setImage(renderSetupImage()); return; }
      if (!this.hasRequiredSettings(settings, global)) { await ev.action.setImage(renderPlaceholderImage()); return; }
      this.apiClient = new CloudflareKvApi(global.apiToken!, global.accountId!);
      await this.updateMetrics(ev);
    });
  }
}
