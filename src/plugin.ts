/**
 * Entry point — registers Stream Deck actions and connects to the SDK.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import streamDeck from "@elgato/streamdeck";

import { AiGatewayMetric } from "./actions/ai-gateway-metric";
import { CloudflareStatus } from "./actions/cloudflare-status";
import { D1DatabaseMetric } from "./actions/d1-database-metric";
import { DnsRecordMonitor } from "./actions/dns-record-monitor";
import { KvNamespaceMetric } from "./actions/kv-namespace-metric";
import { PagesDeploymentStatus } from "./actions/pages-deployment-status";
import { R2StorageMetric } from "./actions/r2-storage-metric";
import { WorkerAnalytics } from "./actions/worker-analytics";
import { WorkerDeploymentStatus } from "./actions/worker-deployment-status";
import { ZoneAnalytics } from "./actions/zone-analytics";
import { updateGlobalSettings, type GlobalSettings } from "./services/global-settings-store";
import { getPollingCoordinator, DEFAULT_REFRESH_INTERVAL_SECONDS } from "./services/polling-coordinator";

// Set the log level for the plugin
streamDeck.logger.setLevel("debug");

// Register actions
streamDeck.actions.registerAction(new AiGatewayMetric());
streamDeck.actions.registerAction(new CloudflareStatus());
streamDeck.actions.registerAction(new D1DatabaseMetric());
streamDeck.actions.registerAction(new DnsRecordMonitor());
streamDeck.actions.registerAction(new KvNamespaceMetric());
streamDeck.actions.registerAction(new PagesDeploymentStatus());
streamDeck.actions.registerAction(new R2StorageMetric());
streamDeck.actions.registerAction(new WorkerAnalytics());
streamDeck.actions.registerAction(new WorkerDeploymentStatus());
streamDeck.actions.registerAction(new ZoneAnalytics());

// ── Global Settings ────────────────────────────────────────────────────────
// API token and account ID are shared across all actions.

streamDeck.settings.getGlobalSettings<GlobalSettings>().then((settings) => {
  updateGlobalSettings(settings ?? {});
  getPollingCoordinator().setIntervalSeconds(
    settings?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
  );
  streamDeck.logger.debug("Global settings loaded");
});

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  updateGlobalSettings(ev.settings ?? {});
  getPollingCoordinator().setIntervalSeconds(
    ev.settings?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
  );
  streamDeck.logger.debug("Global settings updated");
});

// Connect to Stream Deck
streamDeck.connect();
