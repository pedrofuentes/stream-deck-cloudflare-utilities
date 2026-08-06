/**
 * Tests for per-key Cloudflare account selection in Property Inspectors.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type AccountSelectorUtils = {
  applyAccountSelection(
    settings: Record<string, string | undefined>,
    accountId: string,
    accountName: string,
    dependentFields: string[],
  ): boolean;
  fetchAccounts(
    fetchImpl: typeof fetch,
    apiToken: string,
    apiBase?: string,
  ): Promise<Array<{ value: string; label: string }>>;
  migrateLegacyAccount(
    settings: Record<string, string | undefined>,
    globalSettings: Record<string, string | undefined>,
    hasConfiguredResource: boolean,
  ): boolean;
};

function loadAccountSelectorUtils(): AccountSelectorUtils {
  const source = readFileSync(
    resolve(process.cwd(), "plugin/ui/account-selector.js"),
    "utf8",
  );
  const context = { window: {} as Record<string, unknown> };
  runInNewContext(source, context);
  return context.window.CloudflareAccountSelectorUtils as AccountSelectorUtils;
}

describe("CloudflareAccountSelector utilities", () => {
  it("loads every account page and sorts accounts by name", async () => {
    const utils = loadAccountSelectorUtils();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "account-b", name: "Beta" }],
          result_info: { page: 1, total_pages: 2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "account-a", name: "Alpha" }],
          result_info: { page: 2, total_pages: 2 },
        }),
      });

    await expect(
      utils.fetchAccounts(fetchMock as typeof fetch, "token"),
    ).resolves.toEqual([
      { value: "account-a", label: "Alpha" },
      { value: "account-b", label: "Beta" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });

  it("clears account-scoped resources when the selected account changes", () => {
    const utils = loadAccountSelectorUtils();
    const settings = {
      accountId: "account-a",
      accountName: "Alpha",
      databaseId: "database-1",
      databaseName: "Production",
      metric: "reads",
    };

    expect(
      utils.applyAccountSelection(
        settings,
        "account-b",
        "Beta",
        ["databaseId", "databaseName"],
      ),
    ).toBe(true);
    expect(settings).toEqual({
      accountId: "account-b",
      accountName: "Beta",
      databaseId: undefined,
      databaseName: undefined,
      metric: "reads",
    });
  });

  it("retains account-scoped resources when the selected account is unchanged", () => {
    const utils = loadAccountSelectorUtils();
    const settings = {
      accountId: "account-a",
      accountName: "Alpha",
      databaseId: "database-1",
    };

    expect(
      utils.applyAccountSelection(
        settings,
        "account-a",
        "Alpha",
        ["databaseId"],
      ),
    ).toBe(false);
    expect(settings.databaseId).toBe("database-1");
  });

  it("migrates a legacy global account only for an already-configured key", () => {
    const utils = loadAccountSelectorUtils();
    const configuredSettings = { databaseId: "database-1" };
    const blankSettings = {};
    const legacyGlobal = {
      accountId: "legacy-account",
      accountName: "Legacy",
    };

    expect(
      utils.migrateLegacyAccount(
        configuredSettings,
        legacyGlobal,
        true,
      ),
    ).toBe(true);
    expect(configuredSettings).toEqual({
      databaseId: "database-1",
      accountId: "legacy-account",
      accountName: "Legacy",
    });
    expect(
      utils.migrateLegacyAccount(blankSettings, legacyGlobal, false),
    ).toBe(false);
    expect(blankSettings).toEqual({});
  });
});

describe("authenticated Property Inspectors", () => {
  const inspectorFiles = [
    "ai-gateway-metric.html",
    "d1-database-metric.html",
    "dns-record-monitor.html",
    "kv-namespace-metric.html",
    "pages-deployment-status.html",
    "r2-storage-metric.html",
    "worker-analytics.html",
    "worker-deployment-status.html",
    "zone-analytics.html",
  ];

  it.each(inspectorFiles)(
    "%s uses the shared per-key account selector",
    (fileName) => {
      const html = readFileSync(
        resolve(process.cwd(), "plugin/ui", fileName),
        "utf8",
      );
      expect(html).toContain('<script src="account-selector.js"></script>');
      expect(html).toContain("new CloudflareAccountSelector({");
      expect(html).not.toContain("var accountId = globalSettings.accountId;");
    },
  );

  it.each(["dns-record-monitor.html", "zone-analytics.html"])(
    "%s filters the zone list by the selected account",
    (fileName) => {
      const html = readFileSync(
        resolve(process.cwd(), "plugin/ui", fileName),
        "utf8",
      );
      expect(html).toContain("actionSettings.accountId");
      expect(html).toContain("account.id");
    },
  );

  it("keeps the API token and refresh interval global without a global account picker", () => {
    const html = readFileSync(
      resolve(process.cwd(), "plugin/ui/setup.html"),
      "utf8",
    );
    expect(html).not.toContain('id="accountId"');
    expect(html).not.toContain("globalSettings.accountId =");
    expect(html).toContain('id="apiToken"');
    expect(html).toContain('id="refreshIntervalSeconds"');
  });
});
