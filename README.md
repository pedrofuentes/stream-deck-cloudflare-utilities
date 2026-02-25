# Stream Deck Cloudflare Utilities

[![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1081%20passing-brightgreen.svg)](#)

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that provides a set of utilities to display real-time information from [Cloudflare](https://www.cloudflare.com/) directly on your Stream Deck keys.

Built with the [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (v2) and TypeScript.

## Features

- **Cloudflare Status** — Displays the current Cloudflare system status on a Stream Deck key with automatic refresh. Press the key for an instant status check.
- **Worker Deployment Status** — Shows the latest deployment status of a Cloudflare Worker with color-coded indicators:
  - 🟢 **Live** — 100% on a single version
  - 🟡 **Gradual** — Traffic split across multiple versions
  - 🔵 **Recent** — Deployed within the last 10 minutes
  - 🔴 **Error** — Failed to fetch status
  - ⚫ **Unconfigured** — Missing API token, account ID, or worker name
- **AI Gateway Metric** — Displays real-time metrics from a Cloudflare AI Gateway. Press the key to cycle through metrics:
  - 🔵 **Requests** — Total request count
  - 🔵 **Tokens** — Total token usage
  - 🟢 **Cost** — Estimated cost
  - 🔴 **Errors** — Error count
  - 🔵 **Logs Stored** — Number of stored logs
  - Features: adaptive polling, error back-off with 429 rate-limit handling, marquee scrolling for long gateway names, metric cycling via key press
- **Worker Analytics** — Shows real-time analytics for a Cloudflare Worker including:
  - 🔵 **Requests** — Total request count
  - 🟢 **Success Rate** — Percentage of successful requests
  - 🔴 **Errors** — Error count
  - ⏱️ **CPU Time** — Average CPU time per request
  - Features: configurable time range (24h/7d/30d), marquee scrolling for long worker names, metric cycling via key press
- **Pages Deployment Status** — Shows the latest deployment status of a Cloudflare Pages project:
  - 🟢 **Success** — Deployed successfully (shows branch & commit hash)
  - 🟡 **Building** — Build in progress
  - 🔴 **Failed** — Build or deployment failed
  - Features: time-ago display, marquee scrolling for long project names
- **DNS Record Monitor** — Monitors a specific DNS record and displays its value:
  - 🟢 **Proxied** — Record is proxied through Cloudflare
  - 🔵 **DNS Only** — Record exists but is not proxied
  - 🔴 **Missing** — Record not found
  - Features: supports A, AAAA, CNAME, MX, TXT, NS, SRV, CAA record types
- **Zone Analytics** — Displays HTTP analytics for a Cloudflare zone. Press the key to cycle through metrics:
  - 🔵 **Requests** — Total request count
  - 🔵 **Bandwidth** — Total bandwidth
  - 🟢 **Cache Rate** — Cache hit rate percentage
  - 🔴 **Threats** — Threats blocked
  - 🟡 **Visitors** — Unique visitors
  - Features: configurable time range (24h/7d/30d), metric cycling via key press
- **R2 Storage Metric** — Displays R2 bucket storage metrics. Press the key to cycle through metrics:
  - 🔵 **Objects** — Total object count
  - 🟢 **Storage** — Total storage size
  - 🟡 **Class A Ops** — Write operations (PutObject, DeleteObject, etc.)
  - 🔵 **Class B Ops** — Read operations (GetObject, HeadObject)
  - Features: configurable time range (24h/7d/30d), metric cycling via key press
- **D1 Database Metric** — Displays D1 database analytics. Press the key to cycle through metrics:
  - 🔵 **Reads** — Read query count
  - 🟡 **Writes** — Write query count
  - 🔵 **Rows Read** — Total rows read
  - 🟡 **Rows Written** — Total rows written
  - 🟢 **DB Size** — Database file size
  - Features: configurable time range (24h/7d/30d), metric cycling via key press
- **KV Namespace Metric** — Displays Workers KV namespace analytics. Press the key to cycle through metrics:
  - 🔵 **Reads** — Read query count
  - 🟡 **Writes** — Write query count
  - 🔴 **Deletes** — Delete query count
  - 🟢 **Lists** — List query count
  - Features: configurable time range (24h/7d/30d), metric cycling via key press

All actions display a clear **"Please Setup"** indicator when API credentials are missing, guiding you to configure them via the setup window.

> More actions are planned — see the [Roadmap](#roadmap) section below.

### Initial Setup (API Credentials)

API credentials are shared across all actions that need Cloudflare API access (Worker Deployment Status, AI Gateway Metric, Worker Analytics, Pages Deployment Status, DNS Record Monitor, Zone Analytics, R2 Storage Metric, D1 Database Metric, KV Namespace Metric).

1. Add any Cloudflare action to your Stream Deck.
2. In the Property Inspector, click **Setup** to open the credentials window.
3. Enter your **API Token** and **Account ID**.
4. Click **Save** — all actions using Cloudflare API will automatically pick up the credentials.

#### Creating an API Token

1. Go to **Cloudflare Dashboard → My Profile → API Tokens**.
2. Click **Create Token** → use a **Custom Token** template.
3. Under Permissions, add:
   - **Account → Workers Scripts → Read** (for Worker Deployment Status, Worker Analytics)
   - **Account → AI Gateway → Read** (for AI Gateway Metric)
   - **Account → Cloudflare Pages → Read** (for Pages Deployment Status)
   - **Account → D1 → Read** (for D1 Database Metric)
   - **Account → Workers KV Storage → Read** (for KV Namespace Metric)
   - **Account → Workers R2 Storage → Read** (for R2 Storage Metric)
   - **Zone → DNS → Read** (for DNS Record Monitor)
   - **Zone → Analytics → Read** (for Zone Analytics)
4. Save and paste the token into the setup window.

### Setting Up Worker Deployment Status

1. Drag the **Worker Deployment Status** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Worker Name** — Choose from the dropdown (populated from your account).
   - **Refresh Interval** — How often to poll (default: 60 seconds, min: 10).
3. Press the key at any time to force an immediate refresh.

### Setting Up AI Gateway Metric

1. Drag the **AI Gateway Metric** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Gateway** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Requests).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
   - **Refresh Interval** — How often to poll (default: 60 seconds, min: 10).
3. Press the key to cycle through metrics: Requests → Tokens → Cost → Errors → Logs → (repeat).

### Setting Up Worker Analytics

1. Drag the **Worker Analytics** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Worker** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Requests).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
   - **Refresh Interval** — How often to poll (default: 60 seconds, min: 10).
3. Press the key to cycle through metrics: Requests → Success Rate → Errors → CPU Time → (repeat).

### Setting Up Pages Deployment Status

1. Drag the **Pages Deployment Status** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Project** — Choose from the dropdown (populated from your account).
   - **Environment** — Production or Preview.
3. Press the key to force an immediate refresh.

### Setting Up DNS Record Monitor

1. Drag the **DNS Record Monitor** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Zone** — Choose from the dropdown (populated from your account).
   - **Record Name** — Enter the full domain name to monitor (e.g., `example.com`).
   - **Record Type** — Choose the DNS record type (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA).
3. Press the key to force an immediate refresh.

### Setting Up Zone Analytics

1. Drag the **Zone Analytics** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Zone** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Requests).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
3. Press the key to cycle through metrics: Requests → Bandwidth → Cache Rate → Threats → Visitors → (repeat).

### Setting Up R2 Storage Metric

1. Drag the **R2 Storage Metric** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Bucket** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Objects).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
3. Press the key to cycle through metrics: Objects → Storage → Class A Ops → Class B Ops → (repeat).

### Setting Up D1 Database Metric

1. Drag the **D1 Database Metric** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Database** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Reads).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
3. Press the key to cycle through metrics: Reads → Writes → Rows Read → Rows Written → DB Size → (repeat).

### Setting Up KV Namespace Metric

1. Drag the **KV Namespace Metric** action onto a Stream Deck key.
2. In the Property Inspector, select:
   - **Namespace** — Choose from the dropdown (populated from your account).
   - **Metric** — Which metric to display initially (default: Reads).
   - **Time Range** — Data window: 24h, 7d, or 30d (default: 24h).
3. Press the key to cycle through metrics: Reads → Writes → Deletes → Lists → (repeat).

## Requirements

- [Node.js](https://nodejs.org/) v20 or higher
- [Stream Deck](https://www.elgato.com/downloads) software v6.9 or higher
- A Stream Deck device (or [Stream Deck Mobile](https://www.elgato.com/stream-deck-mobile))
- [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro) (`@elgato/cli`)

## Installation

### From Release Package

1. Download the latest `.streamDeckPlugin` file from the [Releases](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/releases) page.
2. Double-click the downloaded file to install it in Stream Deck.

### From Source

```bash
# Clone the repository
git clone https://github.com/pedrofuentes/stream-deck-cloudflare-utilities.git
cd stream-deck-cloudflare-utilities

# Install dependencies
npm install

# Build the plugin
npm run build

# Link to Stream Deck for development
streamdeck link release/com.pedrofuentes.cloudflare-utilities.sdPlugin
```

## Development

### Available Scripts

| Script | Description |
| --- | --- |
| `npm run build` | Build the plugin with Rollup |
| `npm run watch` | Build in watch mode with auto-restart in Stream Deck |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Type-check with TypeScript (no emit) |
| `npm run validate` | Validate the plugin with Stream Deck CLI |
| `npm run validate:consistency` | Check all actions, manifest, PI, icons, tests, & docs are in sync |
| `npm run pack` | Build, test, and package the plugin as `.streamDeckPlugin` |

### Watch Mode

For active development with live reload:

```bash
npm run watch
```

This compiles your TypeScript on every change and automatically restarts the plugin in Stream Deck.

### Testing

All tests must pass before packaging. Tests are written with [Vitest](https://vitest.dev/):

```bash
# Run tests once
npm test

# Run with watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

Coverage thresholds are enforced:
- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%
- **Statements**: 80%

### Packaging a Release

```bash
npm run pack
```

This will:
1. Run all tests (`npm test`)
2. Type-check the project (`npm run lint`)
3. Validate plugin consistency (`npm run validate:consistency`)
4. Build with Rollup
5. Package via `streamdeck pack` into the `dist/` directory

The output is a `.streamDeckPlugin` file ready for distribution.

## Project Structure

```
.
├── plugin/                              # Plugin source assets (tracked in git)
│   ├── imgs/                    # Plugin & action icons
│   │   ├── actions/             # Action-specific icons (SVG)
│   │   └── plugin/              # Plugin-level icons (PNG)
│   ├── ui/                      # Property Inspector HTML files
│   │   ├── setup.html           # Shared credentials setup window
│   │   └── *.html               # Per-action property inspectors
│   ├── manifest.json            # Plugin manifest
│   └── .sdignore                # Files to exclude from packaging
├── release/                             # Build output (gitignored)
│   └── com.pedrofuentes.cloudflare-utilities.sdPlugin/
│       ├── bin/                 # Compiled JS (Rollup output)
│       ├── imgs/                # Copied from plugin/
│       ├── ui/                  # Copied from plugin/
│       └── manifest.json        # Copied from plugin/
├── src/                         # TypeScript source
│   ├── actions/                 # Stream Deck action implementations
│   │   ├── ai-gateway-metric.ts
│   │   ├── cloudflare-status.ts
│   │   ├── d1-database-metric.ts
│   │   ├── dns-record-monitor.ts
│   │   ├── kv-namespace-metric.ts
│   │   ├── pages-deployment-status.ts
│   │   ├── r2-storage-metric.ts
│   │   ├── worker-analytics.ts
│   │   ├── worker-deployment-status.ts
│   │   └── zone-analytics.ts
│   ├── services/                # API clients & business logic
│   │   ├── cloudflare-ai-gateway-api.ts
│   │   ├── cloudflare-api-client.ts
│   │   ├── cloudflare-d1-api.ts
│   │   ├── cloudflare-dns-api.ts
│   │   ├── cloudflare-kv-api.ts
│   │   ├── cloudflare-pages-api.ts
│   │   ├── cloudflare-r2-api.ts
│   │   ├── cloudflare-worker-analytics-api.ts
│   │   ├── cloudflare-workers-api.ts
│   │   ├── cloudflare-zone-analytics-api.ts
│   │   ├── global-settings-store.ts
│   │   ├── key-image-renderer.ts
│   │   ├── marquee-controller.ts
│   │   └── polling-coordinator.ts
│   ├── types/                   # TypeScript type definitions
│   │   ├── cloudflare.ts
│   │   ├── cloudflare-ai-gateway.ts
│   │   ├── cloudflare-d1.ts
│   │   ├── cloudflare-dns.ts
│   │   ├── cloudflare-kv.ts
│   │   ├── cloudflare-pages.ts
│   │   ├── cloudflare-r2.ts
│   │   ├── cloudflare-worker-analytics.ts
│   │   ├── cloudflare-workers.ts
│   │   ├── cloudflare-zone-analytics.ts
│   │   └── index.ts
│   └── plugin.ts                # Plugin entry point
├── scripts/                     # Build & validation scripts
│   └── validate-consistency.ts  # Plugin consistency validator
├── tests/                       # Test files (mirrors src/ structure)
│   ├── actions/
│   ├── scripts/
│   ├── services/
│   └── types/
├── dist/                        # Packaged .streamDeckPlugin output
├── package.json
├── rollup.config.mjs
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Plugin UUID

```
com.pedrofuentes.cloudflare-utilities
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full roadmap. Future utilities may include:

- Token validation on save
- Long-press to open resource in browser
- Cache purge controls
- Firewall event monitoring
- SSL certificate expiry alerts

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).

## Links

- [GitHub Repository](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities)
- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Cloudflare Status Page API](https://yh6f0r4529hb.statuspage.io/api/v2)
