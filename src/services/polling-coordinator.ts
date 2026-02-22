/**
 * Centralized polling coordinator for all Cloudflare actions.
 *
 * Instead of each action managing its own refresh timer, all actions
 * subscribe to this coordinator and receive a tick callback at a
 * unified interval set in global settings.
 *
 * Benefits:
 * - All actions refresh in sync (one coordinated sweep)
 * - Single place to manage the timer lifecycle
 * - Easier rate-limit backoff (per-action skip logic)
 * - Simpler action code (no timeout chains or generation counters)
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

// ── Refresh Interval Options ───────────────────────────────────────────────

/**
 * Allowed refresh interval values (in seconds).
 */
export type RefreshIntervalSeconds = 30 | 60 | 120 | 300 | 600;

/**
 * Dropdown options for the refresh rate setting in setup.html.
 */
export const REFRESH_INTERVAL_OPTIONS: ReadonlyArray<{
  value: RefreshIntervalSeconds;
  label: string;
}> = [
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 120, label: "Every 2 minutes" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
] as const;

/**
 * Default refresh interval when none is configured.
 */
export const DEFAULT_REFRESH_INTERVAL_SECONDS: RefreshIntervalSeconds = 60;

// ── Coordinator ────────────────────────────────────────────────────────────

type TickCallback = () => Promise<void>;

/**
 * Central polling coordinator.
 *
 * Actions subscribe with a unique ID and a tick callback. On each tick
 * the coordinator calls every subscriber's callback via `Promise.allSettled`
 * so that one failing action does not block others.
 *
 * The coordinator uses `setTimeout` (not `setInterval`) to prevent tick
 * drift and to allow clean interval changes mid-flight.
 */
export class PollingCoordinator {
  private subscribers = new Map<string, TickCallback>();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private _intervalMs: number;

  constructor(intervalSeconds: number = DEFAULT_REFRESH_INTERVAL_SECONDS) {
    this._intervalMs = intervalSeconds * 1000;
  }

  /** Current interval in milliseconds. */
  get intervalMs(): number {
    return this._intervalMs;
  }

  /** Current interval in seconds. */
  get intervalSeconds(): number {
    return this._intervalMs / 1000;
  }

  /** Number of active subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Update the polling interval. If a timer is running it is restarted
   * with the new interval immediately.
   */
  setIntervalSeconds(seconds: number): void {
    this._intervalMs = seconds * 1000;
    // Restart if already running
    if (this.timeout) {
      this.stop();
      this.start();
    }
  }

  /**
   * Subscribe an action to receive tick notifications.
   *
   * @param id - Unique subscriber ID (typically the action UUID)
   * @param callback - Async function called on each tick
   * @returns Unsubscribe function
   */
  subscribe(id: string, callback: TickCallback): () => void {
    this.subscribers.set(id, callback);
    // Auto-start when the first subscriber joins
    if (this.subscribers.size === 1 && !this.timeout) {
      this.start();
    }
    return () => this.unsubscribe(id);
  }

  /**
   * Remove a subscriber. Stops the timer when no subscribers remain.
   */
  unsubscribe(id: string): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      this.stop();
    }
  }

  /**
   * Start the polling loop (if not already running and subscribers exist).
   */
  start(): void {
    if (this.timeout) return;
    if (this.subscribers.size === 0) return;
    this.scheduleNextTick();
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /**
   * Execute all subscriber callbacks immediately.
   *
   * Uses `Promise.allSettled` so one subscriber's error does not prevent
   * others from executing or crash the coordinator.
   */
  async tick(): Promise<void> {
    const callbacks = [...this.subscribers.values()];
    await Promise.allSettled(callbacks.map((cb) => cb()));
  }

  // ── Private ────────────────────────────────────────────────────────────

  private scheduleNextTick(): void {
    this.timeout = setTimeout(async () => {
      this.timeout = null;
      await this.tick();
      // Schedule next only if still have subscribers
      if (this.subscribers.size > 0) {
        this.scheduleNextTick();
      }
    }, this._intervalMs);
  }
}

// ── Module-level Singleton ─────────────────────────────────────────────────

let coordinator: PollingCoordinator | null = null;

/**
 * Returns the shared polling coordinator singleton.
 * Creates one on first access with the default interval.
 */
export function getPollingCoordinator(): PollingCoordinator {
  if (!coordinator) {
    coordinator = new PollingCoordinator();
  }
  return coordinator;
}

/**
 * Resets the singleton (for testing). Stops any running timer.
 */
export function resetPollingCoordinator(): void {
  coordinator?.stop();
  coordinator = null;
}
