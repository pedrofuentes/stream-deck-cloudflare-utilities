/**
 * Global settings store for Cloudflare account credentials.
 *
 * Shared across all actions — API token and Account ID are entered once
 * and used by every Cloudflare action on the Stream Deck.
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
  /** Cloudflare Account ID (32-char hex) */
  accountId?: string;
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
