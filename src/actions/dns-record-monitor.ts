/**
 * DNS Record Monitor action for Stream Deck.
 *
 * Monitors a specific DNS record and displays its value and proxy status.
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
  CloudflareDnsApi,
  truncateDomainName,
  type DnsRecordStatus,
} from "../services/cloudflare-dns-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE2_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import type { DnsRecordSettings } from "../types/cloudflare-dns";

/**
 * DNS Record Monitor action — displays the value and status of a DNS record.
 *
 * Color-coded accent bar:
 * - 🟢 Green  → proxied through Cloudflare
 * - 🔵 Blue   → DNS-only (not proxied)
 * - 🔴 Red    → record missing or error
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.dns-record-monitor" })
export class DnsRecordMonitor extends SingletonAction<DnsRecordSettings> {
  private apiClient: CloudflareDnsApi | null = null;
  private lastRecord: DnsRecordStatus | null = null;
  private lastEvent: WillAppearEvent<DnsRecordSettings> | DidReceiveSettingsEvent<DnsRecordSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private skipUntil = 0;
  private static readonly ERROR_BACKOFF_MS = 30 * 1000;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  /** Line 1: record name (18px font → ~10 chars) */
  private marqueeName = new MarqueeController(LINE1_MAX_CHARS);
  /** Line 2: record content/IP (30px font → ~6 chars) */
  private marqueeContent = new MarqueeController(LINE2_MAX_CHARS);
  /** Line 3: type + proxy label (15px font → ~13 chars) */
  private marqueeDetail = new MarqueeController(LINE3_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;
  private isErrorState = false;

  override async onWillAppear(ev: WillAppearEvent<DnsRecordSettings>): Promise<void> {
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

    this.apiClient = new CloudflareDnsApi(global.apiToken!);
    this.marqueeName.setText(settings.recordName ?? "");

    await this.updateRecord(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DnsRecordSettings>): Promise<void> {
    this.lastEvent = ev;

    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastRecord = null;

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

    this.apiClient = new CloudflareDnsApi(global.apiToken!);
    this.marqueeName.setText(settings.recordName ?? "");

    await this.updateRecord(ev);
  }

  override onWillDisappear(_ev: WillDisappearEvent<DnsRecordSettings>): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastRecord = null;
    this.lastEvent = null;
    this.isErrorState = false;
    this.skipUntil = 0;
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
      this.unsubscribeGlobal = null;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<DnsRecordSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

    this.apiClient = new CloudflareDnsApi(global.apiToken!);
    await this.updateRecord(ev);
  }

  private async updateRecord(
    ev: WillAppearEvent<DnsRecordSettings> | KeyDownEvent<DnsRecordSettings> | DidReceiveSettingsEvent<DnsRecordSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.zoneId || !settings.recordName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    try {
      const record = await this.apiClient.getRecordStatus(
        settings.zoneId,
        settings.recordName,
        settings.recordType,
        settings.zoneName
      );

      this.lastRecord = record;
      this.isErrorState = false;
      this.skipUntil = 0;

      // Update marquee text for all lines
      this.marqueeName.setText(record.name);
      this.marqueeContent.setText(record.found ? record.content : "MISSING");
      const detailText = record.found
        ? `${record.type} • ${record.proxied ? "proxied" : "DNS only"}`
        : `${record.type} record`;
      this.marqueeDetail.setText(detailText);

      await ev.action.setImage(this.renderRecord(record));
      this.startMarqueeIfNeeded();
    } catch (error) {
      this.isErrorState = true;
      this.skipUntil = Date.now() + DnsRecordMonitor.ERROR_BACKOFF_MS;

      if (this.lastRecord) {
        streamDeck.logger.debug(
          `Transient error for DNS record "${settings.recordName}", keeping cached display:`,
          error instanceof Error ? error.message : error
        );
        return;
      }

      streamDeck.logger.error(
        `Failed to fetch DNS record "${settings.recordName}":`,
        error
      );
      await ev.action.setImage(
        renderKeyImage({
          line1: truncateDomainName(settings.recordName),
          line2: "ERR",
          statusColor: STATUS_COLORS.red,
        })
      );
    }
  }

  public renderRecord(record: DnsRecordStatus): string {
    const name = this.marqueeName.needsAnimation()
      ? this.marqueeName.getCurrentText()
      : truncateDomainName(record.name);

    if (!record.found) {
      return renderKeyImage({
        line1: name,
        line2: "MISSING",
        line3: `${record.type} record`,
        statusColor: STATUS_COLORS.red,
      });
    }

    const content = this.marqueeContent.needsAnimation()
      ? this.marqueeContent.getCurrentText()
      : truncateForDisplay(record.content, LINE2_MAX_CHARS);

    const proxyLabel = record.proxied ? "proxied" : "DNS only";
    const detailText = `${record.type} • ${proxyLabel}`;
    const detail = this.marqueeDetail.needsAnimation()
      ? this.marqueeDetail.getCurrentText()
      : truncateForDisplay(detailText, LINE3_MAX_CHARS);

    const color = record.proxied ? STATUS_COLORS.green : STATUS_COLORS.blue;

    return renderKeyImage({
      line1: name,
      line2: content,
      line3: detail,
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
    settings: DnsRecordSettings,
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && settings.zoneId && settings.recordName);
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      "dns-record-monitor",
      () => this.onCoordinatorTick(),
    );
  }

  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateRecord(this.lastEvent);
  }

  private startMarqueeIfNeeded(): void {
    const anyNeedsAnimation = this.marqueeName.needsAnimation()
      || this.marqueeContent.needsAnimation()
      || this.marqueeDetail.needsAnimation();

    if (anyNeedsAnimation && this.lastRecord) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(
          () => this.onMarqueeTick(),
          DnsRecordMonitor.MARQUEE_INTERVAL_MS
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
    const c1 = this.marqueeName.tick();
    const c2 = this.marqueeContent.tick();
    const c3 = this.marqueeDetail.tick();
    if ((!c1 && !c2 && !c3) || !this.lastRecord || !this.lastEvent) return;

    await this.lastEvent.action.setImage(
      this.renderRecord(this.lastRecord)
    );
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;

    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;

      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastRecord = null;

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      this.marqueeName.setText(settings.recordName ?? "");

      if (!this.hasCredentials(global)) {
        await ev.action.setImage(renderSetupImage());
        return;
      }

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflareDnsApi(global.apiToken!);
      await this.updateRecord(ev);
    });
  }
}
