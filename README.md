# Stream Deck Cloudflare Utilities

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

> More actions are planned — see the [Roadmap](#roadmap) section below.

### Setting Up Worker Deployment Status

1. Drag the **Worker Deployment Status** action onto a Stream Deck key.
2. In the Property Inspector, enter:
   - **API Token** — A Cloudflare API Token with **Workers Scripts Read** permission.
   - **Account ID** — Your 32-character Cloudflare Account ID (found on the Workers & Pages overview page).
   - **Worker Name** — The name of the Worker script to monitor.
   - **Refresh Interval** — How often to poll (default: 60 seconds, min: 10).
3. Press the key at any time to force an immediate refresh.

#### Creating an API Token

1. Go to **Cloudflare Dashboard → My Profile → API Tokens**.
2. Click **Create Token** → use a **Custom Token** template.
3. Under Permissions, select **Account → Workers Scripts → Read**.
4. Save and paste the token into the action settings.

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
streamdeck link com.pedrofuentes.cloudflare-utilities.sdPlugin
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
3. Build with Rollup
4. Package via `streamdeck pack` into the `dist/` directory

The output is a `.streamDeckPlugin` file ready for distribution.

## Project Structure

```
.
├── com.pedrofuentes.cloudflare-utilities.sdPlugin/  # Compiled plugin (distributed)
│   ├── bin/                     # Compiled JS output
│   ├── imgs/                    # Plugin & action icons
│   │   ├── actions/             # Action-specific icons
│   │   └── plugin/              # Plugin-level icons
│   ├── ui/                      # Property inspector HTML files
│   ├── manifest.json            # Plugin manifest
│   └── .sdignore                # Files to exclude from packaging
├── src/                         # TypeScript source
│   ├── actions/                 # Stream Deck action implementations
│   │   ├── cloudflare-status.ts
│   │   └── worker-deployment-status.ts
│   ├── services/                # API clients & business logic
│   │   ├── cloudflare-api-client.ts
│   │   └── cloudflare-workers-api.ts
│   ├── types/                   # TypeScript type definitions
│   │   ├── cloudflare.ts
│   │   ├── cloudflare-workers.ts
│   │   └── index.ts
│   └── plugin.ts                # Plugin entry point
├── tests/                       # Test files (mirrors src/ structure)
│   ├── actions/
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

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).

## Links

- [GitHub Repository](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities)
- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Cloudflare Status Page API](https://www.cloudflarestatus.com/api)
