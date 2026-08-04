# Changelog — Stream Deck Cloudflare Utilities

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

- Cloudflare accounts are selected per Stream Deck key; the shared plugin settings now contain
  only the API token and refresh interval.
- Existing configured keys migrate their legacy global account selection when opened.

### Fixed

- Tokens with access to multiple Cloudflare accounts can now power keys configured for different
  accounts.
- Authenticated actions isolate runtime state, polling subscriptions, and account-scoped caches by
  key, and discard responses started before an account change.

### Removed

## [1.2.1] - 2026-02

### Changed
- Consolidated three separate "time ago" formatters into one shared utility.
- Comprehensive test rewrites across all 10 actions; coverage raised from 65% to 94% (1,081 tests).
- Removed unused imports and standardized test patterns. No user-facing changes.

## [1.2.0] - 2026-02

### Added
- Six new actions: Pages Deployment Status, DNS Record Monitor, Zone Analytics, R2 Storage Metric, D1 Database Metric, KV Namespace Metric.

### Changed
- Cloudflare Status shows a "last checked" timestamp; AI Gateway shows human-readable gateway names; shared truncation constants across actions.

## [1.1.3] - 2026-02

### Added
- "Please Setup" indicator shown when API credentials are missing.

### Changed
- Updated to the SDK v3 manifest format.

## [1.1.0] - 2026

### Added
- Worker Analytics action; Cloudflare Status component drill-down; AI Gateway error-rate and cache-hit-rate metrics.

---

> This changelog is maintained manually (no release automation). Older releases and full,
> user-facing release notes are in
> [GitHub Releases](https://github.com/pedrofuentes/stream-deck-cloudflare-utilities/releases)
> and `content/release-notes.md`.
