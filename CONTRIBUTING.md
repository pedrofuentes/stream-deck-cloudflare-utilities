# Contributing to Stream Deck Cloudflare Utilities

Thank you for your interest in contributing to this project! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Making Changes](#making-changes)
- [Testing Requirements](#testing-requirements)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

## Code of Conduct

This project follows a standard code of conduct. Be respectful, inclusive, and constructive in all interactions. Harassment and toxic behavior will not be tolerated.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/stream-deck-cloudflare-utilities.git
   cd stream-deck-cloudflare-utilities
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/pedrofuentes/stream-deck-cloudflare-utilities.git
   ```

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [Stream Deck](https://www.elgato.com/downloads) software v6.9+
- A Stream Deck device (or [Stream Deck Mobile](https://www.elgato.com/stream-deck-mobile))
- [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro):
  ```bash
  npm install -g @elgato/cli@latest
  ```

### Install Dependencies

```bash
npm install
```

### Build the Plugin

```bash
npm run build
```

### Link for Development

```bash
streamdeck link release/com.pedrofuentes.cloudflare-utilities.sdPlugin
```

### Watch Mode (Recommended for Development)

```bash
npm run watch
```

This watches for changes and automatically rebuilds + restarts the plugin in Stream Deck.

## Project Architecture

```
src/
├── actions/          # Stream Deck action classes (one per action)
├── services/         # API clients and business logic
├── types/            # TypeScript type definitions and interfaces
└── plugin.ts         # Entry point - registers actions and connects to SD

tests/                # Test files (mirrors src/ structure)
├── actions/
├── services/
└── types/
```

### Key Concepts

- **Actions** (`src/actions/`): Each file exports a class extending `SingletonAction` from `@elgato/streamdeck`. Actions handle key press events and display updates.
- **Services** (`src/services/`): Business logic and external API clients. These are independent of Stream Deck and should be easily testable.
- **Types** (`src/types/`): Shared TypeScript interfaces and type definitions.
- **Plugin entry** (`src/plugin.ts`): Registers all actions with the Stream Deck SDK and calls `streamDeck.connect()`.
- **Manifest** (`plugin/manifest.json`): Defines the plugin metadata, actions, and their UUIDs. Update this when adding new actions.

### Plugin UUID Convention

All action UUIDs follow the pattern: `com.pedrofuentes.cloudflare-utilities.<action-name>`

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
   Use prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.

2. **Make your changes** following the [Coding Standards](#coding-standards).

3. **Add or update tests** to cover your changes, including edge cases.

4. **Run the full test suite**:
   ```bash
   npm test
   ```

5. **Type-check**:
   ```bash
   npm run lint
   ```

6. **Verify build**:
   ```bash
   npm run build
   ```

## Testing Requirements

**All tests must pass before any code is merged.** This is non-negotiable.

### Test Expectations

- Every new feature or action **must** have corresponding tests.
- Bug fixes **must** include a test that reproduces the bug before the fix.
- **Edge cases** must be covered — empty inputs, error conditions, network failures, unexpected API responses, etc.
- Coverage thresholds are enforced at **80%** for branches, functions, lines, and statements.

### Running Tests

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# With coverage report
npm run test:coverage
```

### Test File Location

Test files mirror the `src/` directory structure under `tests/`:
- `src/services/cloudflare-api-client.ts` → `tests/services/cloudflare-api-client.test.ts`
- `src/actions/cloudflare-status.ts` → `tests/actions/cloudflare-status.test.ts`

### Writing Good Tests

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("FeatureName", () => {
  // Group related tests
  describe("methodName", () => {
    it("should handle the happy path", () => { /* ... */ });
    it("should handle empty input", () => { /* ... */ });
    it("should throw on invalid input", () => { /* ... */ });
    it("should handle network errors gracefully", () => { /* ... */ });
  });
});
```

## Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
| --- | --- |
| `feat` | New feature or action |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Maintenance tasks, dependency updates |
| `style` | Code style changes (formatting, etc.) |

### Examples

```
feat(actions): add DNS record viewer action
fix(services): handle rate limiting from Cloudflare API
test(services): add edge case tests for API client timeout
docs(readme): update installation instructions
```

## Pull Request Process

1. **Ensure all tests pass** and coverage thresholds are met.
2. **Update documentation** if your change affects usage, configuration, or the project structure.
3. **Update the README.md** if adding new actions or changing available scripts.
4. **Fill in the PR template** with a description of changes and testing done.
5. **One approval** is required before merging.
6. **Squash and merge** is the preferred merge strategy.

### PR Checklist

- [ ] Tests added/updated and passing
- [ ] Type-checking passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow conventional commits
- [ ] No unnecessary files committed

## Coding Standards

### TypeScript

- Use **strict mode** — the `tsconfig.json` enforces this.
- Prefer `const` over `let`; never use `var`.
- Use explicit return types on public methods.
- Use `interface` for object shapes, `type` for unions/intersections.
- Document public APIs with JSDoc comments.

### File Naming

- Use **kebab-case** for file names: `cloudflare-api-client.ts`
- Use **PascalCase** for classes: `CloudflareApiClient`
- Use **camelCase** for variables and functions: `getSystemStatus`
- Test files: `<source-file-name>.test.ts`

### Error Handling

- Always throw descriptive `Error` objects with context.
- Catch errors at the action level and display user-friendly messages on the key.
- Log errors using `streamDeck.logger.error()`.

### Adding a New Action

1. Create the action file in `src/actions/<action-name>.ts`.
2. Register the action in `src/plugin.ts`.
3. Add the action definition to `plugin/manifest.json`.
4. Create the property inspector HTML in `plugin/ui/<action-name>.html` (if needed).
5. Add action icon SVGs in `plugin/imgs/actions/`.
6. Write comprehensive tests in `tests/actions/<action-name>.test.ts`.
7. Update `README.md` with the new feature.

## Reporting Bugs

Use [GitHub Issues](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/issues) with the following information:

- Stream Deck software version
- Operating system and version
- Plugin version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from `release/com.pedrofuentes.cloudflare-utilities.sdPlugin/logs/`

## Requesting Features

Open a [GitHub Issue](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/issues) with:

- A clear description of the desired feature
- Use case / motivation
- Any mockups or examples if applicable
- Whether you'd be willing to implement it

---

Thank you for helping improve Stream Deck Cloudflare Utilities!
