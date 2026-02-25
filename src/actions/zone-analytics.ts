/**
 * Zone Analytics action for Stream Deck.
 *
 * Displays real-time HTTP analytics for a Cloudflare zone with
 * metric cycling via key press.
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
  CloudflareZoneAnalyticsApi,
  formatBytes,
} from "../services/cloudflare-zone-analytics-api";
import { formatCompactNumber } from "../services/cloudflare-ai-gateway-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import { RateLimitError } from "../services/cloudflare-ai-gateway-api";
import type {
  ZoneAnalyticsSettings,
  ZoneAnalyticsMetricType,
  ZoneAnalyticsMetrics,
} from "../types/cloudflare-zone-analytics";
import {
  ZONE_METRIC_CYCLE_ORDER,
  ZONE_METRIC_SHORT_LABELS,
} from "../types/cloudflare-zone-analytics";

/**
 * Truncates a zone/domain name for display on a tiny OLED key.
 */
export function truncateZoneName(name: string): string {
  return truncateForDisplay(name, LINE1_MAX_CHARS);
}

/**
 * Returns the accent bar color for a given metric type.
 */
export function metricColor(metric: ZoneAnalyticsMetricType): string {
  switch (metric) {
    case "requests":
      return STATUS_COLORS.blue;
    case "bandwidth":
      return STATUS_COLORS.blue;
    case "cache_rate":
      return STATUS_COLORS.green;
    case "threats":
      return STATUS_COLORS.red;
    case "visitors":
      return STATUS_COLORS.amber;
    default:
      return STATUS_COLORS.gray;
  }
}

/**
 * Formats a metric value for display on the key.
 */
export function formatMetricValue(
  metric: ZoneAnalyticsMetricType,
  metrics: ZoneAnalyticsMetrics
): string {
  switch (metric) {
    case "requests":
      return formatCompactNumber(metrics.requests);
    case "bandwidth":
      return formatBytes(metrics.bandwidth);
    case "cache_rate":
      if (metrics.bandwidth === 0) return "0%";
      return `${((metrics.cachedBytes / metrics.bandwidth) * 100).toFixed(1).replace(/\.0$/, "")}%`;
    case "threats":
      return formatCompactNumber(metrics.threats);
    case "visitors":
      return formatCompactNumber(metrics.visitors);
    default:
      return "N/A";
  }
}

/**
 * Zone Analytics action — displays selected analytics metric from a
 * Cloudflare zone on a Stream Deck key.
 *
 * Pressing the key cycles through available metrics:
 *   Requests → Bandwidth → Cache Rate → Threats → Visitors
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.zone-analytics" })
export class ZoneAnalytics extends SingletonAction<ZoneAnalyticsSettings> {
  private apiClient: CloudflareZoneAnalyticsApi | null = null;
  private fetchGeneration = 0;
  private lastMetrics: ZoneAnalyticsMetrics | null = null;
  private lastZoneId: string | null = null;
  private lastZoneName: string | null = null;
  private displayMetric: ZoneAnalyticsMetricType = "requests";
  private lastDataSettings: { zoneId?: string; timeRange?: string } = {};
  private pendingKeyCycle = false;
  private lastEvent: WillAppearEvent<ZoneAnalyticsSettings> | DidReceiveSettingsEvent<ZoneAnalyticsSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;
  private isErrorState = false;
  private skipUntil = 0;

  override async onWillAppear(ev: WillAppearEvent<ZoneAnalyticsSettings>): Promise<void> {
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

    this.apiClient = new CloudflareZoneAnalyticsApi(global.apiToken!);
    this.lastDataSettings = { zoneId: settings.zoneId, timeRange: settings.timeRange };
    this.displayMetric = settings.metric ?? "requests";
    this.marquee.setText(settings.zoneName ?? settings.zoneId ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateZoneName(settings.zoneName ?? settings.zoneId ?? ""),
        line2: "...",
        line3: ZONE_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ZoneAnalyticsSettings>): Promise<void> {
    this.lastEvent = ev;

    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasCredentials(global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastZoneId = null;
      this.lastZoneName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderSetupImage());
      return;
    }

    if (!this.hasRequiredSettings(settings, global)) {
      this.apiClient = null;
      this.lastMetrics = null;
      this.lastZoneId = null;
      this.lastZoneName = null;
      this.lastDataSettings = {};
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const dataChanged =
      settings.zoneId !== this.lastDataSettings.zoneId ||
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
          this.lastZoneName ?? this.lastZoneId ?? "",
          this.lastMetrics,
          settings.timeRange,
          this.marquee.getCurrentText()
        )
      );
      this.startMarqueeIfNeeded();
      return;
    }

    this.stopMarqueeTimer();
    this.apiClient = new CloudflareZoneAnalyticsApi(global.apiToken!);
    this.lastMetrics = null;
    this.lastZoneId = null;
    this.lastZoneName = null;
    this.lastDataSettings = { zoneId: settings.zoneId, timeRange: settings.timeRange };
    this.marquee.setText(settings.zoneName ?? settings.zoneId ?? "");

    await ev.action.setImage(
      renderKeyImage({
        line1: truncateZoneName(settings.zoneName ?? settings.zoneId ?? ""),
        line2: "...",
        line3: ZONE_METRIC_SHORT_LABELS[this.displayMetric] ?? "",
        statusColor: metricColor(this.displayMetric),
      })
    );

    await this.updateMetrics(ev);
  }

  override onWillDisappear(_ev: WillDisappearEvent<ZoneAnalyticsSettings>): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastMetrics = null;
    this.lastZoneId = null;
    this.lastZoneName = null;
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

  override async onKeyDown(ev: KeyDownEvent<ZoneAnalyticsSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

    const currentMetric = this.displayMetric;
    const currentIndex = ZONE_METRIC_CYCLE_ORDER.indexOf(currentMetric);
    const nextIndex = (currentIndex + 1) % ZONE_METRIC_CYCLE_ORDER.length;
    const nextMetric = ZONE_METRIC_CYCLE_ORDER[nextIndex];

    this.displayMetric = nextMetric;

    if (this.lastMetrics) {
      await ev.action.setImage(
        this.renderMetric(
          this.displayMetric,
          this.lastZoneName ?? this.lastZoneId ?? "",
          this.lastMetrics,
          settings.timeRange,
          this.marquee.getCurrentText()
        )
      );
      this.startMarqueeIfNeeded();
    }

    this.pendingKeyCycle = true;
    const newSettings: ZoneAnalyticsSettings = { ...settings, metric: nextMetric };
    await ev.action.setSettings(newSettings);
  }

  private async updateMetrics(
    ev: WillAppearEvent<ZoneAnalyticsSettings> | KeyDownEvent<ZoneAnalyticsSettings> | DidReceiveSettingsEvent<ZoneAnalyticsSettings>
  ): Promise<void> {
    const gen = ++this.fetchGeneration;
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.zoneId) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    const timeRange = settings.timeRange ?? "24h";

    try {
      const metrics = await this.apiClient.getAnalytics(settings.zoneId, timeRange);

      if (this.fetchGeneration !== gen) return;

      this.lastMetrics = metrics;
      this.lastZoneId = settings.zoneId;
      this.lastZoneName = settings.zoneName ?? settings.zoneId;
      this.isErrorState = false;
      this.skipUntil = 0;

      await ev.action.setImage(
        this.renderMetric(
          this.displayMetric,
          settings.zoneName ?? settings.zoneId ?? "",
          metrics,
          timeRange,
          this.marquee.getCurrentText()
        )
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
        streamDeck.logger.debug(
          `Transient error for zone "${settings.zoneId}", keeping cached display:`,
          error instanceof Error ? error.message : error
        );
        return;
      }

      streamDeck.logger.error(
        `Failed to fetch zone analytics for "${settings.zoneId}":`,
        error
      );
      await ev.action.setImage(
        renderKeyImage({
          line1: truncateZoneName(settings.zoneName ?? settings.zoneId ?? ""),
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
    }
  }

  public renderMetric(
    metric: ZoneAnalyticsMetricType,
    zoneName: string,
    metrics: ZoneAnalyticsMetrics,
    timeRange?: string,
    displayName?: string
  ): string {
    const name = displayName ?? truncateZoneName(zoneName);
    const value = formatMetricValue(metric, metrics);
    const color = metricColor(metric);
    const rangeSuffix = ` ${timeRange ?? "24h"}`;
    const label = `${ZONE_METRIC_SHORT_LABELS[metric]}${rangeSuffix}`;

    return renderKeyImage({
      line1: name,
      line2: truncateForDisplay(value, LINE2_MAX_CHARS),
      line3: truncateForDisplay(label, LINE3_MAX_CHARS),
      statusColor: color,
    });
  }

  public hasCredentials(
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken);
  }

  public hasRequiredSettings(
    settings: ZoneAnalyticsSettings,
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && settings.zoneId);
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      "zone-analytics",
      () => this.onCoordinatorTick(),
    );
  }

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
          ZoneAnalytics.MARQUEE_INTERVAL_MS
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
        this.lastZoneId ?? "",
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
      this.lastZoneId = null;
      this.lastZoneName = null;
      this.lastDataSettings = {};

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      this.displayMetric = settings.metric ?? this.displayMetric;
      this.marquee.setText(settings.zoneName ?? settings.zoneId ?? "");

      if (!this.hasCredentials(global)) {
        await ev.action.setImage(renderSetupImage());
        return;
      }

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareZoneAnalyticsApi(global.apiToken!);
      await this.updateMetrics(ev);
    });
  }
}
