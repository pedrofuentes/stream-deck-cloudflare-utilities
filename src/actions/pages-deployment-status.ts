/**
 * Pages Deployment Status action for Stream Deck.
 *
 * Shows the latest deployment status of a Cloudflare Pages project with
 * color-coded indicators and automatic refresh.
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
  CloudflarePagesApi,
  formatTimeAgo,
  truncateProjectName,
  type PagesDeploymentStatus as PagesDeployStatus,
} from "../services/cloudflare-pages-api";
import { getGlobalSettings, onGlobalSettingsChanged } from "../services/global-settings-store";
import { renderKeyImage, renderPlaceholderImage, renderSetupImage, STATUS_COLORS, LINE1_MAX_CHARS, LINE3_MAX_CHARS, truncateForDisplay } from "../services/key-image-renderer";
import { MarqueeController } from "../services/marquee-controller";
import { getPollingCoordinator } from "../services/polling-coordinator";
import type { PagesDeploymentSettings } from "../types/cloudflare-pages";

/**
 * Visual state identifiers for the Stream Deck key.
 */
type StatusState = "success" | "building" | "failed" | "error";

/**
 * Pages Deployment Status action — displays the current deployment status
 * of a Cloudflare Pages project on a Stream Deck key.
 *
 * Color-coded states:
 * - 🟢 Green  → successful deployment
 * - 🟡 Amber  → building / in progress
 * - 🔴 Red    → failed deployment or error
 */
@action({ UUID: "com.pedrofuentes.cloudflare-utilities.pages-deployment-status" })
export class PagesDeploymentStatus extends SingletonAction<PagesDeploymentSettings> {
  private apiClient: CloudflarePagesApi | null = null;
  private lastState: StatusState | null = null;
  private lastStatus: PagesDeployStatus | null = null;
  private lastProjectName: string | null = null;
  private actionRef: { setImage(image: string): Promise<void> } | null = null;
  private displayInterval: ReturnType<typeof setInterval> | null = null;
  private lastEvent: WillAppearEvent<PagesDeploymentSettings> | DidReceiveSettingsEvent<PagesDeploymentSettings> | null = null;
  private unsubscribeGlobal: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private skipUntil = 0;
  private static readonly ERROR_BACKOFF_MS = 30 * 1000;
  private static readonly MARQUEE_INTERVAL_MS = 500;
  private marquee = new MarqueeController(LINE1_MAX_CHARS);
  private marqueeInterval: ReturnType<typeof setInterval> | null = null;

  override async onWillAppear(ev: WillAppearEvent<PagesDeploymentSettings>): Promise<void> {
    this.lastEvent = ev;
    this.subscribeToGlobalSettings();

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

    this.apiClient = new CloudflarePagesApi(global.apiToken!, global.accountId!);
    this.marquee.setText(settings.projectName ?? "");

    await this.updateStatus(ev);
    this.subscribeToCoordinator();
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PagesDeploymentSettings>): Promise<void> {
    this.lastEvent = ev;

    this.clearDisplayInterval();
    this.stopMarqueeTimer();
    this.apiClient = null;
    this.lastState = null;
    this.lastStatus = null;
    this.lastProjectName = null;

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

    this.apiClient = new CloudflarePagesApi(global.apiToken!, global.accountId!);
    this.marquee.setText(settings.projectName ?? "");

    await this.updateStatus(ev);
  }

  override onWillDisappear(_ev: WillDisappearEvent<PagesDeploymentSettings>): void {
    if (this.unsubscribeCoordinator) {
      this.unsubscribeCoordinator();
      this.unsubscribeCoordinator = null;
    }
    this.clearDisplayInterval();
    this.stopMarqueeTimer();
    this.marquee.setText("");
    this.apiClient = null;
    this.lastState = null;
    this.lastStatus = null;
    this.lastProjectName = null;
    this.actionRef = null;
    this.lastEvent = null;
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
      this.unsubscribeGlobal = null;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<PagesDeploymentSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const global = getGlobalSettings();

    if (!this.hasRequiredSettings(settings, global)) {
      return;
    }

    this.apiClient = new CloudflarePagesApi(global.apiToken!, global.accountId!);
    await this.updateStatus(ev);
  }

  private async updateStatus(
    ev: WillAppearEvent<PagesDeploymentSettings> | KeyDownEvent<PagesDeploymentSettings> | DidReceiveSettingsEvent<PagesDeploymentSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!this.apiClient || !settings.projectName) {
      await ev.action.setImage(renderPlaceholderImage());
      return;
    }

    try {
      const status = await this.apiClient.getDeploymentStatus(settings.projectName);

      if (!status) {
        await ev.action.setImage(this.renderStatus("error", settings.projectName, "No deploys"));
        this.startMarqueeIfNeeded();
        return;
      }

      const state = this.resolveState(status);
      this.lastState = state;
      this.lastStatus = status;
      this.lastProjectName = settings.projectName ?? null;
      this.actionRef = ev.action as unknown as { setImage(image: string): Promise<void> };
      await ev.action.setImage(this.renderStatus(state, settings.projectName, undefined, status));
      this.startMarqueeIfNeeded();
      this.startDisplayRefresh();
    } catch (error) {
      this.lastState = "error";
      this.lastStatus = null;
      this.skipUntil = Date.now() + PagesDeploymentStatus.ERROR_BACKOFF_MS;
      this.clearDisplayInterval();
      streamDeck.logger.error(`Failed to fetch Pages deployment status for "${settings.projectName}":`, error);
      await ev.action.setImage(this.renderStatus("error", settings.projectName));
      this.startMarqueeIfNeeded();
    }
  }

  public resolveState(status: PagesDeployStatus): StatusState {
    if (status.isFailed) return "failed";
    if (status.isBuilding) return "building";
    if (status.isSuccess) return "success";
    return "success";
  }

  public renderStatus(
    state: StatusState,
    projectName?: string,
    errorMessage?: string,
    status?: PagesDeployStatus,
    displayName?: string
  ): string {
    const name = displayName
      ?? (projectName ? (this.marquee.needsAnimation() ? this.marquee.getCurrentText() : truncateProjectName(projectName)) : "");

    switch (state) {
      case "error":
        return renderKeyImage({
          line1: name,
          line2: errorMessage ?? "ERR",
          statusColor: STATUS_COLORS.red,
        });

      case "failed": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return renderKeyImage({
          line1: name,
          line2: timeAgo || "Failed",
          line3: truncateForDisplay(status ? `${status.branch} • fail` : "", LINE3_MAX_CHARS),
          statusColor: STATUS_COLORS.red,
        });
      }

      case "building":
        return renderKeyImage({
          line1: name,
          line2: "Building",
          line3: truncateForDisplay(status?.branch ?? "", LINE3_MAX_CHARS),
          statusColor: STATUS_COLORS.amber,
        });

      case "success": {
        const timeAgo = status ? formatTimeAgo(status.createdOn) : "";
        return renderKeyImage({
          line1: name,
          line2: timeAgo || "Live",
          line3: truncateForDisplay(status ? `${status.branch} • ${status.commitHash}` : "", LINE3_MAX_CHARS),
          statusColor: STATUS_COLORS.green,
        });
      }

      default:
        return renderKeyImage({
          line1: name,
          line2: "...",
          statusColor: STATUS_COLORS.gray,
        });
    }
  }

  public hasCredentials(
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId);
  }

  public hasRequiredSettings(
    settings: PagesDeploymentSettings,
    global?: { apiToken?: string; accountId?: string }
  ): boolean {
    const g = global ?? getGlobalSettings();
    return !!(g.apiToken && g.accountId && settings.projectName);
  }

  private subscribeToCoordinator(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = getPollingCoordinator().subscribe(
      "pages-deployment-status",
      () => this.onCoordinatorTick(),
    );
  }

  private async onCoordinatorTick(): Promise<void> {
    if (Date.now() < this.skipUntil) return;
    if (!this.apiClient || !this.lastEvent) return;
    await this.updateStatus(this.lastEvent);
  }

  private startDisplayRefresh(): void {
    this.clearDisplayInterval();
    if (!this.lastStatus || !this.actionRef) return;

    this.displayInterval = setInterval(async () => {
      if (!this.lastStatus || !this.actionRef || !this.lastState) return;
      const image = this.renderStatus(
        this.lastState,
        this.lastProjectName ?? undefined,
        undefined,
        this.lastStatus,
        this.marquee.needsAnimation() ? this.marquee.getCurrentText() : undefined
      );
      await this.actionRef.setImage(image);
    }, 60_000);
  }

  private clearDisplayInterval(): void {
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = null;
    }
  }

  private startMarqueeIfNeeded(): void {
    if (this.marquee.needsAnimation()) {
      if (!this.marqueeInterval) {
        this.marqueeInterval = setInterval(
          () => this.onMarqueeTick(),
          PagesDeploymentStatus.MARQUEE_INTERVAL_MS
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
    if (!changed || !this.lastStatus || !this.actionRef || !this.lastState) return;

    const displayName = this.marquee.getCurrentText();
    const image = this.renderStatus(
      this.lastState,
      this.lastProjectName ?? undefined,
      undefined,
      this.lastStatus,
      displayName
    );
    await this.actionRef.setImage(image);
  }

  private subscribeToGlobalSettings(): void {
    if (this.unsubscribeGlobal) return;

    this.unsubscribeGlobal = onGlobalSettingsChanged(async () => {
      if (!this.lastEvent) return;

      this.clearDisplayInterval();
      this.stopMarqueeTimer();
      this.apiClient = null;
      this.lastState = null;
      this.lastStatus = null;
      this.lastProjectName = null;

      const ev = this.lastEvent;
      const settings = ev.payload.settings;
      const global = getGlobalSettings();

      this.marquee.setText(settings.projectName ?? "");

      if (!this.hasCredentials(global)) {
        await ev.action.setImage(renderSetupImage());
        return;
      }

      if (!this.hasRequiredSettings(settings, global)) {
        await ev.action.setImage(renderPlaceholderImage());
        return;
      }

      this.apiClient = new CloudflarePagesApi(global.apiToken!, global.accountId!);
      await this.updateStatus(ev);
    });
  }
}
