/**
 * Resolves per-key Cloudflare accounts with a narrow legacy fallback.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type {
  AccountSelectionSettings,
  ResolvedAccountSelection,
} from "../types/account-selection";

/**
 * Resolves the account for one key.
 *
 * The deprecated global Account ID is used only for already-configured
 * keys so newly added keys must make an explicit account selection.
 */
export function resolveAccountSelection(
  settings: AccountSelectionSettings,
  legacyAccountId: string | undefined,
  hasConfiguredResource: boolean,
): ResolvedAccountSelection | undefined {
  if (settings.accountId) {
    return {
      accountId: settings.accountId,
      accountName: settings.accountName,
      source: "key",
    };
  }

  if (legacyAccountId && hasConfiguredResource) {
    return {
      accountId: legacyAccountId,
      source: "legacy-global",
    };
  }

  return undefined;
}
