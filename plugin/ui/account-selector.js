/**
 * Shared per-key Cloudflare account selector for Property Inspectors.
 *
 * Loads every account available to the global API token while persisting the
 * selected account ID and name in the current action's settings.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
(function (global) {
  "use strict";

  var DEFAULT_API_BASE = "https://api.cloudflare.com/client/v4";

  function cfHeaders(token) {
    return {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
  }

  function apiError(response, data) {
    if (response.status === 401 || response.status === 403) {
      return new Error("Invalid token or insufficient permissions");
    }
    var message =
      data &&
      data.errors &&
      data.errors[0] &&
      data.errors[0].message;
    return new Error(message || "HTTP " + response.status);
  }

  async function fetchAccounts(fetchImpl, apiToken, apiBase, signal) {
    var accounts = [];
    var page = 1;
    var totalPages = 1;
    var base = apiBase || DEFAULT_API_BASE;

    do {
      var response = await fetchImpl(
        base + "/accounts?per_page=50&page=" + page,
        { headers: cfHeaders(apiToken), signal: signal }
      );
      var data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.result)) {
        throw apiError(response, data);
      }

      data.result.forEach(function (account) {
        accounts.push({
          value: account.id,
          label: account.name || account.id,
        });
      });

      totalPages =
        data.result_info && Number(data.result_info.total_pages)
          ? Number(data.result_info.total_pages)
          : 1;
      page += 1;
    } while (page <= totalPages);

    return accounts.sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
  }

  function applyAccountSelection(
    settings,
    accountId,
    accountName,
    dependentFields
  ) {
    var changed = (settings.accountId || "") !== accountId;
    if (changed) {
      dependentFields.forEach(function (field) {
        settings[field] = undefined;
      });
    }
    settings.accountId = accountId;
    settings.accountName = accountName;
    return changed;
  }

  function migrateLegacyAccount(
    settings,
    globalSettings,
    hasConfiguredResource
  ) {
    if (
      settings.accountId ||
      !hasConfiguredResource ||
      !globalSettings.accountId
    ) {
      return false;
    }
    settings.accountId = globalSettings.accountId;
    settings.accountName = globalSettings.accountName;
    return true;
  }

  function showStatus(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.style.color =
      type === "error"
        ? "#ff6b6b"
        : type === "success"
          ? "#4ade80"
          : "#969696";
  }

  function createRequestGuard(getIdentity) {
    var generation = 0;

    return {
      begin: function () {
        generation += 1;
        return {
          generation: generation,
          identity: getIdentity(),
        };
      },
      invalidate: function () {
        generation += 1;
      },
      isCurrent: function (request) {
        return (
          request &&
          request.generation === generation &&
          request.identity === getIdentity()
        );
      },
    };
  }

  function CloudflareAccountSelector(options) {
    this.options = options;
    this.globalSettings = {};
    this.loadGeneration = 0;
    this.loadAbortController = null;
    this.loadTimeout = null;
    this.reloadTimer = null;
    this.select = new global.FilterableSelect({
      container: options.container,
      setting: "accountId",
      placeholder: "-- Select Account --",
      searchPlaceholder: "Search accounts…",
      threshold: 8,
      onRefresh: this.loadAccounts.bind(this),
      onChange: this.onChange.bind(this),
    });
  }

  CloudflareAccountSelector.prototype.getSettings = function () {
    return this.options.getActionSettings();
  };

  CloudflareAccountSelector.prototype.restore = function () {
    var settings = this.getSettings();
    if (settings.accountId) {
      this.select.value = settings.accountId;
      if (settings.accountName) {
        this.select.setDisplayLabel(settings.accountName);
      }
    } else {
      this.select.value = "";
    }
    this.updateInfo();
  };

  CloudflareAccountSelector.prototype.onGlobalSettings = function (
    globalSettings
  ) {
    this.globalSettings = globalSettings || {};
    var settings = this.getSettings();
    var migrated = migrateLegacyAccount(
      settings,
      this.globalSettings,
      this.options.hasConfiguredResource(settings)
    );
    this.restore();
    if (migrated) {
      this.options.saveActionSettings();
    }
    if (this.reloadTimer) {
      global.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.globalSettings.apiToken) {
      var selector = this;
      this.reloadTimer = global.setTimeout(function () {
        selector.reloadTimer = null;
        selector.loadAccounts();
      }, 200);
    } else {
      this.invalidateAccountLoads();
    }
  };

  CloudflareAccountSelector.prototype.invalidateAccountLoads = function () {
    this.loadGeneration += 1;
    if (this.loadAbortController) {
      this.loadAbortController.abort();
      this.loadAbortController = null;
    }
    if (this.loadTimeout) {
      global.clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
    }
  };

  CloudflareAccountSelector.prototype.onChange = function (value, label) {
    var settings = this.getSettings();
    var oldName = settings.accountName || "";
    var changed = applyAccountSelection(
      settings,
      value,
      label,
      this.options.dependentFields
    );
    if (changed && this.options.onAccountChanged) {
      this.options.onAccountChanged();
    }
    if (changed || oldName !== label) {
      this.options.saveActionSettings();
    }
    this.updateInfo();
  };

  CloudflareAccountSelector.prototype.updateInfo = function () {
    var settings = this.getSettings();
    var info = this.options.infoElement;
    if (!info) return;
    if (!this.globalSettings.apiToken) {
      info.textContent = "API token not configured — click Settings above";
      info.className = "account-info not-configured";
    } else if (!settings.accountId) {
      info.textContent = "Select an account for this key";
      info.className = "account-info not-configured";
    } else {
      info.textContent =
        "✓ " + (settings.accountName || "Account selected for this key");
      info.className = "account-info configured";
    }
  };

  CloudflareAccountSelector.prototype.loadAccounts = async function () {
    var token = this.globalSettings.apiToken;
    if (!token) {
      this.invalidateAccountLoads();
      showStatus(
        this.options.statusElement,
        "Configure the API token in Settings first",
        "error"
      );
      return;
    }

    this.invalidateAccountLoads();
    var generation = ++this.loadGeneration;
    var controller = new global.AbortController();
    this.loadAbortController = controller;
    var selector = this;
    this.loadTimeout = global.setTimeout(function () {
      controller.abort();
    }, 10000);
    function isCurrent() {
      return (
        selector.loadGeneration === generation &&
        selector.globalSettings.apiToken === token
      );
    }

    showStatus(this.options.statusElement, "Loading accounts…", "info");
    try {
      var accounts = await fetchAccounts(
        global.fetch.bind(global),
        token,
        this.options.apiBase,
        controller.signal
      );
      if (!isCurrent()) return;
      this.select.setItems(accounts);

      var settings = this.getSettings();
      var selected = accounts.find(function (account) {
        return account.value === settings.accountId;
      });
      if (selected && settings.accountName !== selected.label) {
        settings.accountName = selected.label;
        this.select.setDisplayLabel(selected.label);
        this.options.saveActionSettings();
      }

      if (accounts.length === 1 && !settings.accountId) {
        this.select.value = accounts[0].value;
        this.onChange(accounts[0].value, accounts[0].label);
      }

      showStatus(
        this.options.statusElement,
        accounts.length +
          " account" +
          (accounts.length === 1 ? "" : "s") +
          " found",
        "success"
      );
      if (this.getSettings().accountId && this.options.onAccountReady) {
        this.options.onAccountReady();
      }
    } catch (error) {
      if (!isCurrent() || error.name === "AbortError") return;
      this.select.setItems([]);
      showStatus(
        this.options.statusElement,
        error.message || "Failed to load accounts",
        "error"
      );
    } finally {
      if (isCurrent()) {
        if (this.loadTimeout) {
          global.clearTimeout(this.loadTimeout);
          this.loadTimeout = null;
        }
        this.loadAbortController = null;
      }
    }
  };

  global.CloudflareAccountSelector = CloudflareAccountSelector;
  global.CloudflareAccountSelectorUtils = {
    applyAccountSelection: applyAccountSelection,
    createRequestGuard: createRequestGuard,
    fetchAccounts: fetchAccounts,
    migrateLegacyAccount: migrateLegacyAccount,
  };
})(typeof window === "undefined" ? globalThis : window);
