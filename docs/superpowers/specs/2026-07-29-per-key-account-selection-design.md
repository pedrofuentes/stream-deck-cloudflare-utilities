# Per-Key Cloudflare Account Selection Design

**Date:** 2026-07-29  
**Status:** Approved

## Problem

A Cloudflare API token can grant access to multiple accounts, but the plugin stores one Account
ID globally. Every authenticated key therefore uses the same account. In addition,
`SingletonAction` instances are shared by all keys of an action type while the current actions
store one client, event, cache, and polling subscription on the instance. Two keys of the same
action type can consequently overwrite each other's runtime state.

## Goal

Keep the API token and refresh interval global while storing `accountId` and `accountName` on
each authenticated key. Keys using the same token, including multiple keys of the same action
type, must query different accounts independently.

## Settings and migration

Global settings retain `apiToken`, `refreshIntervalSeconds`, and a deprecated hidden
`accountId` used only for migration. The nine authenticated action settings include:

```ts
export type AccountSelectionSettings = {
  accountId?: string;
  accountName?: string;
};
```

Cloudflare Status remains unchanged. Account resolution prefers the key-local account. It may
fall back to the deprecated global account only when the key already has its primary resource
configured. A blank new key never inherits the legacy account. There is no bulk migration:
existing configured keys continue through fallback until their Property Inspector next saves a
local account.

## Runtime architecture

Each authenticated action keeps mutable runtime data in a `Map` keyed by `ev.action.id`. A
key's state owns its effective account, API client, last event/settings, caches, request
generation, timers, marquee, error backoff, and polling unsubscribe handle. Appearing,
settings-change, key-press, polling, and disappearing events only access that key's entry.

Account identity forms part of request/cache identity. Changing account invalidates the key's
request generation, clears account-bound cache/display state, and recreates its API client.
Responses captured under an older generation or account cannot update the key. Disappearing
removes only that key's timers, subscriptions, and map entry.

## Property Inspector behavior

`plugin/ui/account-selector.js` provides the account picker used by every authenticated
Property Inspector. It:

- Reads the global API token and paginates the existing `/accounts` endpoint.
- Sorts accounts by name and saves both ID and name locally.
- Auto-selects the sole accessible account when none is selected.
- Preserves and marks an inaccessible saved account instead of erasing settings.
- Shows failures without overwriting the current account or resource.
- Clears only account-dependent resource fields when the effective account ID changes.

Account appears before the action resource. Metric and time-range settings survive account
changes. Worker/project/gateway/zone/bucket/database/namespace selections are cleared as
appropriate; DNS also clears record name/type. Zone Analytics and DNS zone requests use
Cloudflare's supported account-ID filter.

The shared setup window manages only API token and refresh interval. Its Account control is
removed, while the hidden legacy field is preserved in global settings.

## Acceptance

Automated tests prove local-over-legacy precedence, configured-key-only fallback, per-key
runtime isolation for two keys of the same action, stale-response rejection, PI pagination and
failure preservation, dependent-field clearing, and account-filtered zone loading. The full
test, coverage, lint, consistency, build, validation, PR, and Sentinel gates must pass.

No dependencies, new Cloudflare endpoints/datasets, manifest edits, version bump, packaging,
tagging, publishing, or release work are included.
