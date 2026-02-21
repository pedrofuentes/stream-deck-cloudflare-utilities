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
import { WorkerAnalytics } from "./actions/worker-analytics";
import { WorkerDeploymentStatus } from "./actions/worker-deployment-status";
import { updateGlobalSettings, type GlobalSettings } from "./services/global-settings-store";

// Set the log level for the plugin
streamDeck.logger.setLevel("debug");

// Register actions
streamDeck.actions.registerAction(new AiGatewayMetric());
streamDeck.actions.registerAction(new CloudflareStatus());
streamDeck.actions.registerAction(new WorkerAnalytics());
streamDeck.actions.registerAction(new WorkerDeploymentStatus());

// ── Global Settings ────────────────────────────────────────────────────────
// API token and account ID are shared across all actions.

streamDeck.settings.getGlobalSettings<GlobalSettings>().then((settings) => {
  updateGlobalSettings(settings ?? {});
  streamDeck.logger.debug("Global settings loaded");
});

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  updateGlobalSettings(ev.settings ?? {});
  streamDeck.logger.debug("Global settings updated");
});

// Connect to Stream Deck
streamDeck.connect();
