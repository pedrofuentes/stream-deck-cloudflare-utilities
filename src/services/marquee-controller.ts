/**
 * Manages marquee (scrolling text) state for text that exceeds a visible width.
 *
 * Uses a **circular/wrapping** scroll: the text loops continuously with a
 * separator gap between repetitions, like a news ticker. When the window
 * reaches the separator, the original text starts appearing on the right,
 * creating a seamless loop.
 *
 * When text fits within `maxVisible`, no scrolling is needed and `tick()`
 * always returns `false`.
 *
 * Example with "kleine-gateway" (14 chars), maxVisible=10, separator="  •  ":
 *   offset 0:  "kleine-gat"
 *   offset 1:  "leine-gate"
 *   ...
 *   offset 4:  "ne-gateway"
 *   offset 5:  "e-gateway "     ← separator starts appearing
 *   offset 7:  "gateway  •"    ← bullet visible
 *   ...
 *   offset 19: back to "kleine-gat" (full loop)
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/** Number of ticks to pause at the start of each scroll cycle. */
export const MARQUEE_PAUSE_TICKS = 3;

/** Separator inserted between repetitions for visual spacing. */
export const MARQUEE_SEPARATOR = "  \u2022  ";

export class MarqueeController {
  private text = "";
  private readonly maxVisible: number;
  private offset = 0;
  private pauseRemaining = 0;

  constructor(maxVisible = 10) {
    this.maxVisible = maxVisible;
  }

  /**
   * Sets the text to display/scroll. Resets scroll position if text changes.
   */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.offset = 0;
    this.pauseRemaining = MARQUEE_PAUSE_TICKS;
  }

  /**
   * Returns `true` if the text is too long for the visible area and
   * needs scrolling animation.
   */
  needsAnimation(): boolean {
    return this.text.length > this.maxVisible;
  }

  /**
   * Returns the currently visible text window (up to `maxVisible` characters).
   *
   * For long text, reads from a virtual loop buffer of
   * `text + separator + text` using modular indexing, producing a seamless
   * circular scroll effect.
   */
  getCurrentText(): string {
    if (!this.needsAnimation()) return this.text;

    const loop = this.text + MARQUEE_SEPARATOR;
    const loopLen = loop.length;
    let result = "";
    for (let i = 0; i < this.maxVisible; i++) {
      result += loop[(this.offset + i) % loopLen];
    }
    return result;
  }

  /**
   * Advances the scroll by one step.
   *
   * Scroll cycle:
   *   1. Pause at offset 0 for `MARQUEE_PAUSE_TICKS` ticks
   *   2. Scroll left one character per tick, wrapping circularly
   *   3. When offset returns to 0, pause again
   *
   * @returns `true` if the visible text changed (caller should re-render),
   *          `false` if still pausing or no animation needed.
   */
  tick(): boolean {
    if (!this.needsAnimation()) return false;

    if (this.pauseRemaining > 0) {
      this.pauseRemaining--;
      return false;
    }

    const loopLen = this.text.length + MARQUEE_SEPARATOR.length;
    this.offset = (this.offset + 1) % loopLen;

    // Completed a full loop — pause at the start
    if (this.offset === 0) {
      this.pauseRemaining = MARQUEE_PAUSE_TICKS;
    }

    return true;
  }

  /**
   * Resets scroll position to the beginning with an initial pause.
   */
  reset(): void {
    this.offset = 0;
    this.pauseRemaining = MARQUEE_PAUSE_TICKS;
  }

  /** Returns the full (unsliced) text. */
  getFullText(): string {
    return this.text;
  }
}
