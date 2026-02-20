import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getGlobalSettings,
  updateGlobalSettings,
  onGlobalSettingsChanged,
  resetGlobalSettingsStore,
  type GlobalSettings,
} from "../../src/services/global-settings-store";

describe("global-settings-store", () => {
  beforeEach(() => {
    resetGlobalSettingsStore();
  });

  // ── getGlobalSettings ──────────────────────────────────────────────────

  describe("getGlobalSettings", () => {
    it("should return empty object initially", () => {
      expect(getGlobalSettings()).toEqual({});
    });

    it("should return a defensive copy", () => {
      updateGlobalSettings({ apiToken: "tok", accountId: "acc" });
      const a = getGlobalSettings();
      const b = getGlobalSettings();
      expect(a).toEqual(b);
      expect(a).not.toBe(b); // different references
    });

    it("should not allow mutation of internal state through returned object", () => {
      updateGlobalSettings({ apiToken: "tok" });
      const settings = getGlobalSettings();
      settings.apiToken = "mutated";
      expect(getGlobalSettings().apiToken).toBe("tok");
    });
  });

  // ── updateGlobalSettings ───────────────────────────────────────────────

  describe("updateGlobalSettings", () => {
    it("should store settings", () => {
      updateGlobalSettings({ apiToken: "token1", accountId: "account1" });
      expect(getGlobalSettings()).toEqual({
        apiToken: "token1",
        accountId: "account1",
      });
    });

    it("should replace previous settings entirely", () => {
      updateGlobalSettings({ apiToken: "tok1", accountId: "acc1" });
      updateGlobalSettings({ apiToken: "tok2" });
      expect(getGlobalSettings()).toEqual({ apiToken: "tok2" });
    });

    it("should store empty object", () => {
      updateGlobalSettings({ apiToken: "tok" });
      updateGlobalSettings({});
      expect(getGlobalSettings()).toEqual({});
    });

    it("should make a defensive copy of input", () => {
      const input: GlobalSettings = { apiToken: "tok" };
      updateGlobalSettings(input);
      input.apiToken = "mutated";
      expect(getGlobalSettings().apiToken).toBe("tok");
    });

    it("should handle undefined fields", () => {
      updateGlobalSettings({ apiToken: undefined, accountId: undefined });
      const result = getGlobalSettings();
      expect(result.apiToken).toBeUndefined();
      expect(result.accountId).toBeUndefined();
    });
  });

  // ── onGlobalSettingsChanged ────────────────────────────────────────────

  describe("onGlobalSettingsChanged", () => {
    it("should call listener on update", () => {
      const listener = vi.fn();
      onGlobalSettingsChanged(listener);
      updateGlobalSettings({ apiToken: "tok" });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ apiToken: "tok" });
    });

    it("should call multiple listeners in order", () => {
      const order: number[] = [];
      onGlobalSettingsChanged(() => order.push(1));
      onGlobalSettingsChanged(() => order.push(2));
      onGlobalSettingsChanged(() => order.push(3));
      updateGlobalSettings({ apiToken: "tok" });
      expect(order).toEqual([1, 2, 3]);
    });

    it("should call listener on every update", () => {
      const listener = vi.fn();
      onGlobalSettingsChanged(listener);
      updateGlobalSettings({ apiToken: "a" });
      updateGlobalSettings({ apiToken: "b" });
      updateGlobalSettings({ apiToken: "c" });
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("should return an unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = onGlobalSettingsChanged(listener);
      expect(typeof unsub).toBe("function");
    });

    it("should stop calling listener after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = onGlobalSettingsChanged(listener);
      updateGlobalSettings({ apiToken: "a" });
      expect(listener).toHaveBeenCalledOnce();

      unsub();
      updateGlobalSettings({ apiToken: "b" });
      expect(listener).toHaveBeenCalledOnce(); // still 1
    });

    it("should not affect other listeners when one unsubscribes", () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const unsubA = onGlobalSettingsChanged(listenerA);
      onGlobalSettingsChanged(listenerB);

      unsubA();
      updateGlobalSettings({ apiToken: "tok" });

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledOnce();
    });

    it("should handle double-unsubscribe gracefully", () => {
      const listener = vi.fn();
      const unsub = onGlobalSettingsChanged(listener);
      unsub();
      unsub(); // Should not throw
      updateGlobalSettings({ apiToken: "tok" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("should not call listeners that were never subscribed", () => {
      const listener = vi.fn();
      updateGlobalSettings({ apiToken: "tok" });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── resetGlobalSettingsStore ───────────────────────────────────────────

  describe("resetGlobalSettingsStore", () => {
    it("should clear stored settings", () => {
      updateGlobalSettings({ apiToken: "tok", accountId: "acc" });
      resetGlobalSettingsStore();
      expect(getGlobalSettings()).toEqual({});
    });

    it("should remove all listeners", () => {
      const listener = vi.fn();
      onGlobalSettingsChanged(listener);
      resetGlobalSettingsStore();
      updateGlobalSettings({ apiToken: "tok" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("should allow fresh subscriptions after reset", () => {
      const oldListener = vi.fn();
      onGlobalSettingsChanged(oldListener);
      resetGlobalSettingsStore();

      const newListener = vi.fn();
      onGlobalSettingsChanged(newListener);
      updateGlobalSettings({ apiToken: "tok" });

      expect(oldListener).not.toHaveBeenCalled();
      expect(newListener).toHaveBeenCalledOnce();
    });

    it("should be idempotent", () => {
      updateGlobalSettings({ apiToken: "tok" });
      resetGlobalSettingsStore();
      resetGlobalSettingsStore();
      expect(getGlobalSettings()).toEqual({});
    });
  });
});
