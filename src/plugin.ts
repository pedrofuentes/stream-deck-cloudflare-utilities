import streamDeck from "@elgato/streamdeck";

import { CloudflareStatus } from "./actions/cloudflare-status";

// Set the log level for the plugin
streamDeck.logger.setLevel("debug");

// Register the Cloudflare Status action
streamDeck.actions.registerAction(new CloudflareStatus());

// Connect to Stream Deck
streamDeck.connect();
