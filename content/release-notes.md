# Release Notes — Elgato Marketplace

> **Character limit per release**: 1,500 characters
> Update this file with every new release. Most recent first.

---

## v1.2.1 (February 2026)

**Code quality & reliability improvements**

• Unified time display — Consolidated 3 separate "time ago" formatting functions into one shared utility with style options.
• Test coverage boost — Comprehensive test rewrites across all 10 actions. Coverage increased from 65% to 94% (1,081 tests, all passing).
• Code cleanup — Removed unused imports and standardized test patterns across all action files.

No user-facing changes — this release improves code quality, test coverage, and long-term maintainability.

**Character count**: ~440

---

## v1.2.0 (February 2026)

**Massive expansion — 6 new actions + visual polish!**

New actions:
• Pages Deployment Status — Monitor Cloudflare Pages projects: deployment status, branch, commit hash, and time since deploy.
• DNS Record Monitor — Watch any DNS record (A, AAAA, CNAME, MX, TXT). See value, type, and proxy status with color-coded indicators.
• Zone Analytics — Traffic stats for any zone: requests, bandwidth, cache rate, threats, and unique visitors. Cycle metrics with a key press.
• R2 Storage Metric — Track R2 bucket storage: object count, payload size, and operation counts.
• D1 Database Metric — Monitor D1 databases: rows read/written, queries, and database size.
• KV Namespace Metric — Workers KV operation counts: reads, writes, deletes, and list operations.

Visual polish:
• Cloudflare Status now shows "last checked" timestamp on line 3 (e.g., "just now", "2m ago").
• AI Gateway displays human-readable gateway names instead of IDs.
• D1 Database Size label no longer shows a time range (it's a point-in-time value).
• All truncation functions now use shared constants for consistency.
• Internal code cleanup: marquee width uses shared LINE1_MAX_CHARS constant across all 10 actions.

**Character count**: ~945

---

## v1.1.3 (February 2026)

**Improved setup experience & SDK update**

• New "Please Setup" indicator — Actions now display a clear "Please Setup" message when API credentials are missing, guiding you to configure them instead of showing a confusing error state.
• SDK compatibility — Updated to SDK v3 manifest format for future-proofing and improved compatibility with the latest Stream Deck software.
• Internal documentation improvements for contributor onboarding.

**Character count**: ~410

---

## v1.1.2 (February 2026)

**Project restructure**

• Reorganized plugin directory structure for cleaner builds and easier development.
• No user-facing changes — this release improves maintainability for contributors.

**Character count**: ~205

---

## v1.1.1 (February 2026)

**Polish & reliability**

• Marquee scrolling — Long resource names now scroll smoothly on all actions instead of being truncated.
• Error backoff — All actions now gracefully handle API errors and rate limits with intelligent retry timing.
• Improved Property Inspector dropdowns with better loading states and error handling.
• New shared polling coordinator for consistent, resource-efficient refresh across all actions.
• Switched Cloudflare Status API to statuspage.io endpoint (fixes 403 errors from CloudFront WAF).
• Added plugin consistency validator to catch manifest/action/test mismatches automatically.

**Character count**: ~565

---

## v1.1.0 (February 2026)

**Major feature release — 2 new actions + 3 enhancements!**

New actions:
• Worker Analytics — Monitor invocations, success rate, errors, and CPU time for any Worker. Cycle through metrics with a key press, choose 24h/7d/30d time ranges.

Enhancements to existing actions:
• Cloudflare Status — Now supports component drill-down! Pick a specific component (CDN, DNS, Workers, Pages, etc.) instead of only seeing the overall status.
• AI Gateway Metric — Added Error Rate metric (errors ÷ requests × 100) for at-a-glance reliability monitoring.
• AI Gateway Metric — Added Cache Hit Rate metric to track how effectively your gateway caches are working.

Plus: Roadmap documentation, branching model, and contributor guidelines.

**Character count**: ~680

---

## v1.0.0 (February 2026)

**Initial release**

Cloudflare Utilities brings real-time Cloudflare monitoring to your Stream Deck!

• Cloudflare Status — Live system status on a key with automatic refresh.
• Worker Deployment Status — Color-coded deployment status for any Worker (live/gradual/recent/error).
• AI Gateway Metric — Real-time gateway metrics: requests, tokens, cost, errors, and logs. Press to cycle.
• Shared API credentials — Set up once, all actions share them.
• OLED-optimized display with accent bar pattern for instant visual status recognition.

**Character count**: ~490
