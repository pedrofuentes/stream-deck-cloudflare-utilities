/**
 * Lifecycle and integration tests for per-key Cloudflare account selection.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type AccountOption = { value: string; label: string };
type SelectorOptions = {
  dependentFields: string[];
  hasConfiguredResource(settings: Record<string, unknown>): boolean;
};
type RequestGuard = {
  begin(): unknown;
  invalidate(): void;
  isCurrent(request: unknown): boolean;
};

class MockFilterableSelect {
  static instances: MockFilterableSelect[] = [];

  value = "";
  items: AccountOption[] = [];
  displayLabel = "";

  constructor(public readonly options: Record<string, unknown>) {
    MockFilterableSelect.instances.push(this);
  }

  setItems(items: AccountOption[]): void {
    this.items = items;
  }

  setDisplayLabel(label: string): void {
    this.displayLabel = label;
  }
}

function accountResponse(id: string, name: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      result: [{ id, name }],
      result_info: { total_pages: 1 },
    }),
  };
}

function loadSelector(fetchMock: ReturnType<typeof vi.fn>) {
  MockFilterableSelect.instances = [];
  const source = readFileSync(
    resolve(process.cwd(), "plugin/ui/account-selector.js"),
    "utf8",
  );
  const context: Record<string, unknown> = {
    AbortController,
    clearTimeout,
    fetch: fetchMock,
    FilterableSelect: MockFilterableSelect,
    setTimeout,
  };
  context.window = context;
  context.globalThis = context;
  runInNewContext(source, context);
  return context;
}

function createSelector(
  fetchMock: ReturnType<typeof vi.fn>,
  initialSettings: Record<string, unknown> = {},
) {
  const context = loadSelector(fetchMock);
  const settings = { ...initialSettings };
  const saveActionSettings = vi.fn();
  const onAccountChanged = vi.fn();
  const onAccountReady = vi.fn();
  const statusElement = { textContent: "", style: { color: "" } };
  const infoElement = { textContent: "", className: "" };
  const Selector = context.CloudflareAccountSelector as new (
    options: Record<string, unknown>,
  ) => {
    globalSettings: Record<string, string | undefined>;
    loadAccounts(): Promise<void>;
    onChange(value: string, label: string): void;
    onGlobalSettings(settings: Record<string, string | undefined>): void;
  };
  const selector = new Selector({
    container: {},
    dependentFields: ["resourceId", "resourceName"],
    getActionSettings: () => settings,
    hasConfiguredResource: (value: Record<string, unknown>) =>
      Boolean(value.resourceId),
    infoElement,
    onAccountChanged,
    onAccountReady,
    saveActionSettings,
    statusElement,
  });
  const select = MockFilterableSelect.instances[0];
  return {
    context,
    infoElement,
    onAccountChanged,
    onAccountReady,
    saveActionSettings,
    select,
    selector,
    settings,
    statusElement,
  };
}

describe("CloudflareAccountSelector lifecycle", () => {
  it("does not fetch without a token and reports the setup requirement", async () => {
    const fetchMock = vi.fn();
    const harness = createSelector(fetchMock);

    await harness.selector.loadAccounts();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.statusElement.textContent).toContain("Configure the API token");
  });

  it("migrates a configured key and saves the account locally", () => {
    const harness = createSelector(vi.fn(), { resourceId: "resource-1" });

    harness.selector.onGlobalSettings({
      accountId: "legacy-account",
      accountName: "Legacy",
    });

    expect(harness.settings).toMatchObject({
      accountId: "legacy-account",
      accountName: "Legacy",
      resourceId: "resource-1",
    });
    expect(harness.saveActionSettings).toHaveBeenCalledTimes(1);
  });

  it("auto-selects the sole accessible account and runs callbacks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(accountResponse("account-a", "Alpha"));
    const harness = createSelector(fetchMock);
    harness.selector.globalSettings = { apiToken: "token" };

    await harness.selector.loadAccounts();

    expect(harness.settings).toMatchObject({
      accountId: "account-a",
      accountName: "Alpha",
    });
    expect(harness.saveActionSettings).toHaveBeenCalledTimes(1);
    expect(harness.onAccountChanged).toHaveBeenCalledTimes(1);
    expect(harness.onAccountReady).toHaveBeenCalledTimes(1);
  });

  it("clears dependent resources when the user selects another account", () => {
    const harness = createSelector(vi.fn(), {
      accountId: "account-a",
      accountName: "Alpha",
      resourceId: "resource-1",
      resourceName: "Production",
    });

    harness.selector.onChange("account-b", "Beta");

    expect(harness.settings).toMatchObject({
      accountId: "account-b",
      accountName: "Beta",
      resourceId: undefined,
      resourceName: undefined,
    });
    expect(harness.onAccountChanged).toHaveBeenCalledTimes(1);
    expect(harness.saveActionSettings).toHaveBeenCalledTimes(1);
  });

  it("preserves settings when account loading fails", async () => {
    const harness = createSelector(
      vi.fn().mockRejectedValue(new Error("network down")),
      {
        accountId: "account-a",
        accountName: "Alpha",
        resourceId: "resource-1",
      },
    );
    harness.selector.globalSettings = { apiToken: "token" };

    await harness.selector.loadAccounts();

    expect(harness.settings).toMatchObject({
      accountId: "account-a",
      accountName: "Alpha",
      resourceId: "resource-1",
    });
    expect(harness.statusElement.textContent).toBe("network down");
  });

  it("allows only the latest token request to update the account list", async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolvePromise) => { resolveOld = resolvePromise; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolvePromise) => { resolveNew = resolvePromise; }),
      );
    const harness = createSelector(fetchMock);

    harness.selector.globalSettings = { apiToken: "old-token" };
    const oldLoad = harness.selector.loadAccounts();
    harness.selector.globalSettings = { apiToken: "new-token" };
    const newLoad = harness.selector.loadAccounts();

    resolveNew(accountResponse("account-new", "New"));
    await newLoad;
    resolveOld(accountResponse("account-old", "Old"));
    await oldLoad;

    expect(harness.select.items).toEqual([
      { value: "account-new", label: "New" },
    ]);
    expect(harness.settings.accountId).toBe("account-new");
  });

  it("invalidates an older account-scoped resource request", () => {
    const context = loadSelector(vi.fn());
    const createRequestGuard = (
      context.CloudflareAccountSelectorUtils as {
        createRequestGuard(identity: () => string): RequestGuard;
      }
    ).createRequestGuard;
    let identity = "token-a\u0000account-a";
    const guard = createRequestGuard(() => identity);
    const oldRequest = guard.begin();

    identity = "token-a\u0000account-b";
    const newRequest = guard.begin();

    expect(guard.isCurrent(oldRequest)).toBe(false);
    expect(guard.isCurrent(newRequest)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(newRequest)).toBe(false);
  });
});

describe("authenticated Property Inspector initialization", () => {
  const inspectors = [
    {
      file: "ai-gateway-metric.html",
      resource: "gatewayId",
      dependentFields: ["gatewayId", "gatewayName"],
    },
    {
      file: "d1-database-metric.html",
      resource: "databaseId",
      dependentFields: ["databaseId", "databaseName"],
    },
    {
      file: "dns-record-monitor.html",
      resource: "recordName",
      configured: { zoneId: "zone-1", recordName: "example.com" },
      dependentFields: ["zoneId", "zoneName", "recordName"],
    },
    {
      file: "kv-namespace-metric.html",
      resource: "namespaceId",
      dependentFields: ["namespaceId", "namespaceName"],
    },
    {
      file: "pages-deployment-status.html",
      resource: "projectName",
      dependentFields: ["projectName"],
    },
    {
      file: "r2-storage-metric.html",
      resource: "bucketName",
      dependentFields: ["bucketName"],
    },
    {
      file: "worker-analytics.html",
      resource: "workerName",
      dependentFields: ["workerName"],
    },
    {
      file: "worker-deployment-status.html",
      resource: "workerName",
      dependentFields: ["workerName"],
    },
    {
      file: "zone-analytics.html",
      resource: "zoneId",
      dependentFields: ["zoneId", "zoneName"],
    },
  ];

  it.each(inspectors)(
    "$file executes account and resource guard wiring",
    ({ file, resource, configured, dependentFields }) => {
      const html = readFileSync(
        resolve(process.cwd(), "plugin/ui", file),
        "utf8",
      );
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      const inlineScript = scripts.at(-1)?.[1] ?? "";
      const elements = new Map<string, Record<string, unknown>>();
      const selectorOptions: SelectorOptions[] = [];
      const guardFactory = vi.fn(() => ({
        begin: vi.fn(),
        invalidate: vi.fn(),
        isCurrent: vi.fn(),
      }));
      const context: Record<string, unknown> = {
        CloudflareAccountSelector: class {
          restore = vi.fn();
          onGlobalSettings = vi.fn();

          constructor(options: SelectorOptions) {
            selectorOptions.push(options);
          }
        },
        CloudflareAccountSelectorUtils: {
          createRequestGuard: guardFactory,
        },
        FilterableSelect: MockFilterableSelect,
        WebSocket: class {
          static OPEN = 1;
        },
        document: {
          getElementById(id: string) {
            if (!elements.has(id)) {
              elements.set(id, {
                addEventListener: vi.fn(),
                className: "",
                id,
                style: {},
                textContent: "",
                value: "",
              });
            }
            return elements.get(id);
          },
        },
        encodeURIComponent,
        fetch: vi.fn(),
      };
      context.window = {
        open: vi.fn(),
      };

      runInNewContext(inlineScript, context);

      expect(selectorOptions).toHaveLength(1);
      expect([...selectorOptions[0].dependentFields]).toEqual(dependentFields);
      expect(
        selectorOptions[0].hasConfiguredResource(
          configured ?? { [resource]: "configured" },
        ),
      ).toBe(true);
      expect(selectorOptions[0].hasConfiguredResource({})).toBe(false);
      expect(guardFactory).toHaveBeenCalledTimes(1);
    },
  );
});
