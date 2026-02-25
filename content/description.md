# Elgato Marketplace — Plugin Description

> **Last updated**: v1.2.1 (February 2026)
> **Character limit**: 4,000 characters
> **Current length**: ~3,800 characters

---

**Cloudflare Utilities** puts your Cloudflare infrastructure at your fingertips — right on your Stream Deck.

Monitor Workers, AI Gateways, Pages, DNS, and system status without ever leaving your editor, terminal, or game. One glance at your deck tells you everything: deployment status, request counts, error rates, costs, storage, and more — all updating in real time.

## 🔥 10 Powerful Actions

### Cloudflare Status
Keep an eye on Cloudflare's global health. See the overall system status — or drill down into a specific component like CDN, DNS, Workers, or Pages. Shows "last checked" timestamp so you always know how fresh the data is. Press for an instant refresh.

### Worker Deployment Status
Know the state of your Cloudflare Worker at a glance:
• 🟢 Live — Deployed and serving 100% of traffic
• 🟡 Gradual — Traffic is split across versions (gradual rollout)
• 🔵 Recent — Deployed in the last 10 minutes
• 🔴 Error — Something went wrong
Color-coded accent bars make status unmistakable even from across the room.

### AI Gateway Metric
Real-time metrics from your Cloudflare AI Gateway. Press to cycle through: Requests, Tokens, Cost, Errors, Error Rate, Cache Hit Rate, and Logs Stored. Features adaptive polling that backs off intelligently on rate limits.

### Worker Analytics
Deep analytics for any Cloudflare Worker: Requests, Success Rate, Errors, CPU Time (P50/P99), Wall Time, and Subrequests. Choose your time window (24h, 7d, or 30d) and press the key to cycle.

### Pages Deployment Status
Monitor your Cloudflare Pages projects. See deployment status (success/failed/building), time since last deploy, branch name, and commit hash — all color-coded for instant recognition.

### DNS Record Monitor
Watch a specific DNS record (A, AAAA, CNAME, MX, TXT). See the current value, record type, and proxy status. Green for proxied, blue for DNS-only, red if the record is missing.

### Zone Analytics
Traffic analytics for any zone: total requests, bandwidth, cache hit rate, threats blocked, and unique visitors. Pick your time window and cycle through metrics.

### R2 Storage Metric
Monitor R2 bucket storage: object count, payload size, metadata size, and Class A/B operations. Stay on top of your storage usage and costs.

### D1 Database Metric
Track D1 database analytics: rows read, rows written, read queries, write queries, and database size. Keep an eye on your serverless database usage.

### KV Namespace Metric
Workers KV operation counts: reads, writes, deletes, and list operations. Monitor your edge state usage patterns at a glance.

## ✨ Built for Your Workflow

• **Shared credentials** — Set up your Cloudflare API Token and Account ID once, and every action uses them automatically.
• **Smart dropdowns** — Resources are auto-populated from your account. No copy-pasting IDs.
• **Marquee scrolling** — Long resource names scroll smoothly so nothing gets cut off.
• **Adaptive polling** — Refresh intervals you control (default 60s, min 10s), with automatic backoff when APIs are busy.
• **OLED-optimized** — High-contrast dark theme with color-coded accent bars designed specifically for Stream Deck displays.
• **Press to refresh** — Any key can be pressed for an instant update.
• **Human-readable names** — All actions display resource names, not IDs.

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
4. Select your resource — and you're live!

Open source and community-driven. Contributions welcome on GitHub.
