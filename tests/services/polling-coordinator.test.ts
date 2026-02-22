/**
 * Tests for the Polling Coordinator service.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PollingCoordinator,
  getPollingCoordinator,
  resetPollingCoordinator,
  REFRESH_INTERVAL_OPTIONS,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
} from "../../src/services/polling-coordinator";

describe("PollingCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPollingCoordinator();
    vi.useRealTimers();
  });

  // ── Constants ──────────────────────────────────────────────────────────

  describe("constants", () => {
    it("should export DEFAULT_REFRESH_INTERVAL_SECONDS as 60", () => {
      expect(DEFAULT_REFRESH_INTERVAL_SECONDS).toBe(60);
    });

    it("should export REFRESH_INTERVAL_OPTIONS with correct values", () => {
      const values = REFRESH_INTERVAL_OPTIONS.map((o) => o.value);
      expect(values).toEqual([30, 60, 120, 300, 600]);
    });

    it("should have human-readable labels for all options", () => {
      for (const option of REFRESH_INTERVAL_OPTIONS) {
        expect(option.label).toBeTruthy();
        expect(typeof option.label).toBe("string");
      }
    });
  });

  // ── Constructor ────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should default to 60s interval", () => {
      const coordinator = new PollingCoordinator();
      expect(coordinator.intervalMs).toBe(60_000);
      expect(coordinator.intervalSeconds).toBe(60);
    });

    it("should accept custom interval in seconds", () => {
      const coordinator = new PollingCoordinator(30);
      expect(coordinator.intervalMs).toBe(30_000);
      expect(coordinator.intervalSeconds).toBe(30);
    });

    it("should start with zero subscribers", () => {
      const coordinator = new PollingCoordinator();
      expect(coordinator.subscriberCount).toBe(0);
    });
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────────

  describe("subscribe", () => {
    it("should add a subscriber", () => {
      const coordinator = new PollingCoordinator();
      coordinator.subscribe("test-1", async () => {});
      expect(coordinator.subscriberCount).toBe(1);
    });

    it("should return an unsubscribe function", () => {
      const coordinator = new PollingCoordinator();
      const unsub = coordinator.subscribe("test-1", async () => {});
      expect(typeof unsub).toBe("function");
    });

    it("should auto-start timer on first subscriber", async () => {
      const coordinator = new PollingCoordinator(1); // 1s interval
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test-1", callback);

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not duplicate timer when adding second subscriber", async () => {
      const coordinator = new PollingCoordinator(1);
      const cb1 = vi.fn().mockResolvedValue(undefined);
      const cb2 = vi.fn().mockResolvedValue(undefined);

      coordinator.subscribe("test-1", cb1);
      coordinator.subscribe("test-2", cb2);

      await vi.advanceTimersByTimeAsync(1_000);
      // Both should be called exactly once
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("should replace callback for same subscriber ID", () => {
      const coordinator = new PollingCoordinator();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      coordinator.subscribe("test-1", cb1);
      coordinator.subscribe("test-1", cb2);

      expect(coordinator.subscriberCount).toBe(1);
    });
  });

  describe("unsubscribe", () => {
    it("should remove subscriber by ID", () => {
      const coordinator = new PollingCoordinator();
      coordinator.subscribe("test-1", async () => {});
      coordinator.unsubscribe("test-1");
      expect(coordinator.subscriberCount).toBe(0);
    });

    it("should stop timer when last subscriber leaves", async () => {
      const coordinator = new PollingCoordinator(1);
      const callback = vi.fn().mockResolvedValue(undefined);
      const unsub = coordinator.subscribe("test-1", callback);

      unsub();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should be safe to unsubscribe non-existent ID", () => {
      const coordinator = new PollingCoordinator();
      expect(() => coordinator.unsubscribe("non-existent")).not.toThrow();
    });

    it("returned unsubscribe function should work", async () => {
      const coordinator = new PollingCoordinator(1);
      const callback = vi.fn().mockResolvedValue(undefined);
      const unsub = coordinator.subscribe("test-1", callback);

      unsub();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ── tick ────────────────────────────────────────────────────────────────

  describe("tick", () => {
    it("should call all subscriber callbacks", async () => {
      const coordinator = new PollingCoordinator();
      const cb1 = vi.fn().mockResolvedValue(undefined);
      const cb2 = vi.fn().mockResolvedValue(undefined);
      const cb3 = vi.fn().mockResolvedValue(undefined);

      coordinator.subscribe("a", cb1);
      coordinator.subscribe("b", cb2);
      coordinator.subscribe("c", cb3);

      await coordinator.tick();

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
    });

    it("should not crash when one subscriber throws", async () => {
      const coordinator = new PollingCoordinator();
      const failing = vi.fn().mockRejectedValue(new Error("Boom"));
      const passing = vi.fn().mockResolvedValue(undefined);

      coordinator.subscribe("fail", failing);
      coordinator.subscribe("pass", passing);

      await coordinator.tick();

      expect(failing).toHaveBeenCalledTimes(1);
      expect(passing).toHaveBeenCalledTimes(1);
    });

    it("should work with zero subscribers", async () => {
      const coordinator = new PollingCoordinator();
      await expect(coordinator.tick()).resolves.toBeUndefined();
    });
  });

  // ── setIntervalSeconds ─────────────────────────────────────────────────

  describe("setIntervalSeconds", () => {
    it("should update intervalMs", () => {
      const coordinator = new PollingCoordinator(60);
      coordinator.setIntervalSeconds(30);
      expect(coordinator.intervalMs).toBe(30_000);
      expect(coordinator.intervalSeconds).toBe(30);
    });

    it("should restart timer with new interval when running", async () => {
      const coordinator = new PollingCoordinator(10);
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test", callback);

      // Change to 2s interval while running
      coordinator.setIntervalSeconds(2);

      // Advance 2s — should fire with new interval
      await vi.advanceTimersByTimeAsync(2_000);
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance another 2s — should fire again
      await vi.advanceTimersByTimeAsync(2_000);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should not start timer when no subscribers exist", () => {
      const coordinator = new PollingCoordinator(60);
      coordinator.setIntervalSeconds(30);
      // No error, timer not started
      expect(coordinator.subscriberCount).toBe(0);
    });
  });

  // ── start / stop ───────────────────────────────────────────────────────

  describe("start / stop", () => {
    it("should not start without subscribers", async () => {
      const coordinator = new PollingCoordinator(1);
      coordinator.start();

      // No callbacks to check, but ensure no error
      await vi.advanceTimersByTimeAsync(2_000);
    });

    it("should stop pending timer", async () => {
      const coordinator = new PollingCoordinator(1);
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test", callback);

      coordinator.stop();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should be safe to stop when not running", () => {
      const coordinator = new PollingCoordinator();
      expect(() => coordinator.stop()).not.toThrow();
    });

    it("should be safe to start when already running", async () => {
      const coordinator = new PollingCoordinator(1);
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test", callback);

      // Call start again — should be a no-op
      coordinator.start();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1); // not 2
    });
  });

  // ── Timer lifecycle ────────────────────────────────────────────────────

  describe("timer lifecycle", () => {
    it("should schedule next tick after current tick completes", async () => {
      const coordinator = new PollingCoordinator(1);
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test", callback);

      // Advance 3 intervals
      await vi.advanceTimersByTimeAsync(3_000);
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should stop scheduling after last subscriber unsubscribes mid-tick", async () => {
      const coordinator = new PollingCoordinator(1);
      let unsub: () => void;

      const callback = vi.fn().mockImplementation(async () => {
        unsub(); // Unsubscribe during tick
      });

      unsub = coordinator.subscribe("test", callback);

      // First tick fires callback which unsubscribes
      await vi.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1);

      // No more ticks should fire
      await vi.advanceTimersByTimeAsync(3_000);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // ── Singleton ──────────────────────────────────────────────────────────

  describe("singleton (getPollingCoordinator / resetPollingCoordinator)", () => {
    it("should return the same instance on repeated calls", () => {
      const a = getPollingCoordinator();
      const b = getPollingCoordinator();
      expect(a).toBe(b);
    });

    it("should return a new instance after reset", () => {
      const a = getPollingCoordinator();
      resetPollingCoordinator();
      const b = getPollingCoordinator();
      expect(a).not.toBe(b);
    });

    it("should stop the timer on reset", async () => {
      const coordinator = getPollingCoordinator();
      const callback = vi.fn().mockResolvedValue(undefined);
      coordinator.subscribe("test", callback);

      resetPollingCoordinator();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should default to DEFAULT_REFRESH_INTERVAL_SECONDS", () => {
      const coordinator = getPollingCoordinator();
      expect(coordinator.intervalSeconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    });
  });
});
