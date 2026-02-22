# Elgato Marketplace — Plugin Description

> **Last updated**: v1.1.3 (February 2026)
> **Character limit**: 4,000 characters
> **Current length**: ~2,800 characters

---

**Cloudflare Utilities** puts your Cloudflare infrastructure at your fingertips — right on your Stream Deck.

Monitor Workers, AI Gateways, and system status without ever leaving your editor, terminal, or game. One glance at your deck tells you everything: deployment status, request counts, error rates, costs, and more — all updating in real time.

## 🔥 4 Powerful Actions

### Cloudflare Status
Keep an eye on Cloudflare's global health. See the overall system status — or drill down into a specific component like CDN, DNS, Workers, or Pages. The key updates automatically and lights up instantly if there's an incident. Press for an instant refresh.

### Worker Deployment Status
Know the state of your Cloudflare Worker at a glance:
• 🟢 Live — Deployed and serving 100% of traffic
• 🟡 Gradual — Traffic is split across versions (gradual rollout)
• 🔵 Recent — Deployed in the last 10 minutes
• 🔴 Error — Something went wrong
Color-coded accent bars make status unmistakable even from across the room.

### AI Gateway Metric
Real-time metrics from your Cloudflare AI Gateway, displayed on a single key. Press to cycle through:
• Requests — Total request count
• Tokens — Token usage
• Cost — Estimated spend
• Errors — Error count & error rate
• Cache Hits — See how much you're saving
• Logs Stored — Stored log count
Features adaptive polling that backs off intelligently on rate limits (429).

### Worker Analytics
Deep analytics for any Cloudflare Worker:
• Requests — Total invocations
• Success Rate — Percentage of successful requests
• Errors — Error count
• CPU Time — Average CPU time per request
Choose your time window (24h, 7d, or 30d) and press the key to cycle through metrics.

## ✨ Built for Your Workflow

• **Shared credentials** — Set up your Cloudflare API Token and Account ID once, and every action uses them automatically.
• **Smart dropdowns** — Workers and Gateways are auto-populated from your account. No copy-pasting IDs.
• **Marquee scrolling** — Long resource names scroll smoothly so nothing gets cut off.
• **Adaptive polling** — Refresh intervals you control (default 60s, min 10s), with automatic backoff when APIs are busy.
• **OLED-optimized** — High-contrast dark theme with color-coded accent bars designed specifically for Stream Deck displays.
• **Press to refresh** — Any key can be pressed for an instant update.

## 🔒 Privacy First

Your API credentials never leave your machine. They're stored locally in Stream Deck's global settings — no cloud sync, no telemetry, no third-party servers.

## 🛠 Requirements

• Stream Deck software v6.9+
• A Cloudflare account with an API Token (read-only access is sufficient)
• Works on Windows 10+ and macOS 13+

## 🚀 Getting Started

1. Install the plugin from the Stream Deck Store
2. Drag any Cloudflare action onto a key
3. Click "Setup" in the Property Inspector to enter your API credentials
4. Select your Worker, Gateway, or component — and you're live!

Open source and community-driven. Contributions welcome on GitHub.
