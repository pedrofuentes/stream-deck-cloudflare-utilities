/**
 * Shared per-key Cloudflare account selection types.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Cloudflare account selected for one Stream Deck key.
 */
export type AccountSelectionSettings = {
  /** Cloudflare Account ID (32-char hex) */
  accountId?: string;
  /** Human-readable Cloudflare account name */
  accountName?: string;
};

/**
 * Effective account chosen for an authenticated key.
 */
export type ResolvedAccountSelection = {
  accountId: string;
  accountName?: string;
  source: "key" | "legacy-global";
};
