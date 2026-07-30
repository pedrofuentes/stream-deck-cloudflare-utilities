/**
 * Tests for per-key Cloudflare account selection and legacy migration.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, expect, it } from "vitest";

import { resolveAccountSelection } from "../../src/services/account-selection";

describe("resolveAccountSelection", () => {
  it("should prefer the account saved on the key over the legacy global account", () => {
    expect(
      resolveAccountSelection(
        { accountId: "key-account", accountName: "Key Account" },
        "legacy-account",
        true,
      ),
    ).toEqual({
      accountId: "key-account",
      accountName: "Key Account",
      source: "key",
    });
  });

  it("should use the legacy global account for an already-configured key", () => {
    expect(
      resolveAccountSelection({}, "legacy-account", true),
    ).toEqual({
      accountId: "legacy-account",
      source: "legacy-global",
    });
  });

  it("should not assign the legacy global account to a blank new key", () => {
    expect(
      resolveAccountSelection({}, "legacy-account", false),
    ).toBeUndefined();
  });

  it("should return undefined when neither a local nor legacy account exists", () => {
    expect(
      resolveAccountSelection({}, undefined, true),
    ).toBeUndefined();
  });

  it("should treat an empty local account ID as missing", () => {
    expect(
      resolveAccountSelection(
        { accountId: "", accountName: "Stale Name" },
        "legacy-account",
        true,
      ),
    ).toEqual({
      accountId: "legacy-account",
      source: "legacy-global",
    });
  });
});
