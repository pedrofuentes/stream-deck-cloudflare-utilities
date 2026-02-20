import streamDeck from "@elgato/streamdeck";

import { CloudflareStatus } from "./actions/cloudflare-status";
import { WorkerDeploymentStatus } from "./actions/worker-deployment-status";

// Set the log level for the plugin
streamDeck.logger.setLevel("debug");

// Register actions
streamDeck.actions.registerAction(new CloudflareStatus());
streamDeck.actions.registerAction(new WorkerDeploymentStatus());

// Connect to Stream Deck
streamDeck.connect();
