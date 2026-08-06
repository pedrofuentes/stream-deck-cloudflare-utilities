/**
 * Global settings store for shared Cloudflare authentication and polling.
 *
 * The API token and refresh interval are shared across all actions.
 * Account selection belongs to each key; the old global Account ID remains
 * temporarily readable for migration.
 *
 * Plugin.ts keeps this store in sync with Stream Deck's global settings.
 * Actions read from it whenever they need credentials.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Global settings shared across all Cloudflare actions.
 */
export type GlobalSettings = {
  /** Cloudflare API Bearer token */
  apiToken?: string;
  /** @deprecated Legacy Account ID used only to migrate configured keys */
  accountId?: string;
  /** Shared refresh interval in seconds (30, 60, 120, 300, 600) */
  refreshIntervalSeconds?: number;
};

let current: GlobalSettings = {};

type Listener = (settings: GlobalSettings) => void;
const listeners: Listener[] = [];

/**
 * Returns the current global settings (defensive copy).
 */
export function getGlobalSettings(): GlobalSettings {
  return { ...current };
}

/**
 * Updates the global settings and notifies all subscribers.
 */
export function updateGlobalSettings(settings: GlobalSettings): void {
  current = { ...settings };
  for (const fn of listeners) {
    fn(current);
  }
}

/**
 * Subscribes to global settings changes.
 * Returns an unsubscribe function.
 */
export function onGlobalSettingsChanged(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Resets the store (for testing).
 */
export function resetGlobalSettingsStore(): void {
  current = {};
  listeners.length = 0;
}
