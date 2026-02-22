# Stream Deck Cloudflare Utilities

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-557%20passing-brightgreen.svg)](#)

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

> More actions are planned — see the [Roadmap](#roadmap) section below.

### Initial Setup (API Credentials)

API credentials are shared across all actions that need Cloudflare API access (Worker Deployment Status, AI Gateway Metric, Worker Analytics).

1. Add any Cloudflare action to your Stream Deck.
2. In the Property Inspector, click **Setup** to open the credentials window.
3. Enter your **API Token** and **Account ID**.
4. Click **Save** — all actions using Cloudflare API will automatically pick up the credentials.

#### Creating an API Token

1. Go to **Cloudflare Dashboard → My Profile → API Tokens**.
2. Click **Create Token** → use a **Custom Token** template.
3. Under Permissions, add:
   - **Account → Workers Scripts → Read** (for Worker Deployment Status)
   - **Account → AI Gateway → Read** (for AI Gateway Metric)
   - **Account → Workers Scripts → Read** (also needed for Worker Analytics)
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
│   │   ├── worker-analytics.ts
│   │   └── worker-deployment-status.ts
│   ├── services/                # API clients & business logic
│   │   ├── cloudflare-ai-gateway-api.ts
│   │   ├── cloudflare-api-client.ts
│   │   ├── cloudflare-worker-analytics-api.ts
│   │   ├── cloudflare-workers-api.ts
│   │   ├── global-settings-store.ts
│   │   ├── key-image-renderer.ts
│   │   └── marquee-controller.ts
│   ├── types/                   # TypeScript type definitions
│   │   ├── cloudflare.ts
│   │   ├── cloudflare-ai-gateway.ts
│   │   ├── cloudflare-worker-analytics.ts
│   │   ├── cloudflare-workers.ts
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

Roadmap items will be discussed and tracked in [GitHub Issues](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/issues). Future utilities may include:

- Zone analytics dashboard
- DNS record management
- Firewall event monitoring
- Cache purge controls
- SSL certificate expiry alerts
- AI Gateway logs viewer

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).

## Links

- [GitHub Repository](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities)
- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Cloudflare Status Page API](https://yh6f0r4529hb.statuspage.io/api/v2)
