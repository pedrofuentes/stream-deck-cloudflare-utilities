/**
 * Tests for the marquee controller.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect } from "vitest";
import { MarqueeController, MARQUEE_PAUSE_TICKS, MARQUEE_SEPARATOR } from "../../src/services/marquee-controller";

describe("MarqueeController", () => {
  // ── constructor ────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should default to maxVisible of 10", () => {
      const mc = new MarqueeController();
      mc.setText("12345678901"); // 11 chars
      expect(mc.getCurrentText()).toBe("1234567890"); // first 10
    });

    it("should accept custom maxVisible", () => {
      const mc = new MarqueeController(5);
      mc.setText("1234567"); // 7 chars
      expect(mc.getCurrentText()).toBe("12345"); // first 5
    });
  });

  // ── setText ────────────────────────────────────────────────────────────

  describe("setText", () => {
    it("should set the text", () => {
      const mc = new MarqueeController();
      mc.setText("hello");
      expect(mc.getFullText()).toBe("hello");
    });

    it("should reset offset when text changes", () => {
      const mc = new MarqueeController(5);
      mc.setText("abcdefgh"); // 8 chars, needs scroll

      // Tick past initial pause and advance
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
      mc.tick(); // offset → 1
      expect(mc.getCurrentText()).toBe("bcdef");

      // Change text — should reset to offset 0
      mc.setText("12345678");
      expect(mc.getCurrentText()).toBe("12345");
    });

    it("should not reset when setting the same text", () => {
      const mc = new MarqueeController(5);
      mc.setText("abcdefgh");

      // Tick past pause and advance
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
      mc.tick(); // offset → 1
      expect(mc.getCurrentText()).toBe("bcdef");

      // Set same text — should NOT reset
      mc.setText("abcdefgh");
      expect(mc.getCurrentText()).toBe("bcdef");
    });

    it("should handle empty string", () => {
      const mc = new MarqueeController();
      mc.setText("");
      expect(mc.getFullText()).toBe("");
      expect(mc.getCurrentText()).toBe("");
    });
  });

  // ── needsAnimation ─────────────────────────────────────────────────────

  describe("needsAnimation", () => {
    it("should return false when text fits", () => {
      const mc = new MarqueeController(10);
      mc.setText("hello");
      expect(mc.needsAnimation()).toBe(false);
    });

    it("should return false for exactly maxVisible chars", () => {
      const mc = new MarqueeController(10);
      mc.setText("1234567890");
      expect(mc.needsAnimation()).toBe(false);
    });

    it("should return true when text exceeds maxVisible", () => {
      const mc = new MarqueeController(10);
      mc.setText("12345678901"); // 11 chars
      expect(mc.needsAnimation()).toBe(true);
    });

    it("should return false for empty text", () => {
      const mc = new MarqueeController();
      mc.setText("");
      expect(mc.needsAnimation()).toBe(false);
    });

    it("should return false when no text has been set", () => {
      const mc = new MarqueeController();
      expect(mc.needsAnimation()).toBe(false);
    });
  });

  // ── getCurrentText ─────────────────────────────────────────────────────

  describe("getCurrentText", () => {
    it("should return full text when it fits", () => {
      const mc = new MarqueeController(10);
      mc.setText("hello");
      expect(mc.getCurrentText()).toBe("hello");
    });

    it("should return first maxVisible chars initially for long text", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars
      expect(mc.getCurrentText()).toBe("kleine-gat");
    });

    it("should return empty string for empty text", () => {
      const mc = new MarqueeController();
      expect(mc.getCurrentText()).toBe("");
    });

    it("should return empty string when no text has been set", () => {
      const mc = new MarqueeController();
      expect(mc.getCurrentText()).toBe("");
    });

    it("should wrap around showing separator and text start", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars + 5 separator = 19 loop

      // Scroll to where separator becomes visible
      // At offset 5: "e-gateway "
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
      for (let i = 0; i < 5; i++) mc.tick();
      expect(mc.getCurrentText()).toBe("e-gateway ");
    });

    it("should show text wrapping around through separator", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // loop = "kleine-gateway  \u2022  "

      // At offset 10: "eway  \u2022  k" — separator with dot visible, text wrapping back
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
      for (let i = 0; i < 10; i++) mc.tick();
      expect(mc.getCurrentText()).toBe("eway  \u2022  k");
    });
  });

  // ── tick ────────────────────────────────────────────────────────────────

  describe("tick", () => {
    it("should return false when text fits (no animation)", () => {
      const mc = new MarqueeController(10);
      mc.setText("hello");
      expect(mc.tick()).toBe(false);
    });

    it("should return false for exactly maxVisible (no animation)", () => {
      const mc = new MarqueeController(10);
      mc.setText("1234567890");
      expect(mc.tick()).toBe(false);
    });

    it("should pause initially before scrolling", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars

      // Pause ticks — no visual change
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) {
        expect(mc.tick()).toBe(false);
      }
      expect(mc.getCurrentText()).toBe("kleine-gat"); // still at start
    });

    it("should scroll after initial pause", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars

      // Skip initial pause
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

      // Scrolling starts
      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("leine-gate"); // offset 1

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("eine-gatew"); // offset 2

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("ine-gatewa"); // offset 3

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("ne-gateway"); // offset 4
    });

    it("should scroll continuously through separator (circular)", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars, separator = "   "

      // Skip pause and scroll to where separator appears
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

      // Scroll 5 steps → offset 5
      for (let i = 0; i < 5; i++) mc.tick();
      expect(mc.getCurrentText()).toBe("e-gateway "); // separator starts

      mc.tick(); // offset 6
      expect(mc.getCurrentText()).toBe("-gateway  "); // more separator

      mc.tick(); // offset 7
      expect(mc.getCurrentText()).toBe("gateway  \u2022"); // separator dot visible

      mc.tick(); // offset 8
      expect(mc.getCurrentText()).toBe("ateway  \u2022 "); // dot + trailing space

      mc.tick(); // offset 9
      expect(mc.getCurrentText()).toBe("teway  \u2022  "); // full separator visible
    });

    it("should complete a full loop and pause at start", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // 14 chars, loop = 14 + 5 = 19

      // Skip initial pause
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

      // Scroll 19 steps to complete full loop (offset wraps back to 0)
      for (let i = 0; i < 19; i++) {
        expect(mc.tick()).toBe(true);
      }

      // Back at offset 0 — should pause now
      expect(mc.getCurrentText()).toBe("kleine-gat");
      expect(mc.tick()).toBe(false); // pausing
    });

    it("should have all ticks return true during scrolling (no mid-scroll pause)", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // loop length = 19

      // Skip initial pause
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

      // All 19 scroll ticks should return true
      const results: boolean[] = [];
      for (let i = 0; i < 19; i++) {
        results.push(mc.tick());
      }
      expect(results.every((r) => r === true)).toBe(true);
    });

    it("should handle minimal overflow (1 extra char)", () => {
      const mc = new MarqueeController(10);
      mc.setText("12345678901"); // 11 chars, loop = 11 + 5 = 16

      // Initial pause
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) {
        expect(mc.tick()).toBe(false);
      }

      // Scroll 1 step
      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("2345678901"); // offset 1

      // Continue scrolling — at offset 2, separator appears
      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("345678901 "); // offset 2
    });

    it("should work with custom maxVisible", () => {
      const mc = new MarqueeController(3);
      mc.setText("abcde"); // 5 chars, loop = 5 + 5 = 10

      // Initial pause
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("bcd"); // offset 1

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("cde"); // offset 2

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("de "); // offset 3 — separator

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("e  "); // offset 4

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("  \u2022"); // offset 5 — dot

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe(" \u2022 "); // offset 6

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("\u2022  "); // offset 7

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("  a"); // offset 8 — wrapping

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe(" ab"); // offset 9

      expect(mc.tick()).toBe(true);
      expect(mc.getCurrentText()).toBe("abc"); // offset 0 — back to start
    });

    it("should track full cycle: pause → scroll → pause", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway"); // loop = 19

      const results: boolean[] = [];

      // Initial pause: 3 false
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) results.push(mc.tick());
      // Scroll full loop: 19 true
      for (let i = 0; i < 19; i++) results.push(mc.tick());
      // Back at start pause: 3 false
      for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) results.push(mc.tick());

      expect(results).toEqual([
        false, false, false,                                                           // initial pause
        true, true, true, true, true, true, true, true, true, true,                    // scroll (10)
        true, true, true, true, true, true, true, true, true,                          // scroll (9 more = 19 total)
        false, false, false,                                                           // start pause (new cycle)
      ]);
    });
  });

  // ── reset ──────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should reset to beginning with pause", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway");

      // Advance past pause and scroll
      for (let i = 0; i < MARQUEE_PAUSE_TICKS + 2; i++) mc.tick();
      expect(mc.getCurrentText()).toBe("eine-gatew"); // offset 2

      mc.reset();
      expect(mc.getCurrentText()).toBe("kleine-gat"); // back to start

      // Should have pause after reset
      expect(mc.tick()).toBe(false);
    });

    it("should have no effect when text fits", () => {
      const mc = new MarqueeController(10);
      mc.setText("hello");
      mc.reset();
      expect(mc.getCurrentText()).toBe("hello");
      expect(mc.tick()).toBe(false);
    });
  });

  // ── getFullText ────────────────────────────────────────────────────────

  describe("getFullText", () => {
    it("should return the full unsliced text", () => {
      const mc = new MarqueeController(5);
      mc.setText("abcdefghijk");
      expect(mc.getFullText()).toBe("abcdefghijk");
    });

    it("should return empty string when no text set", () => {
      const mc = new MarqueeController();
      expect(mc.getFullText()).toBe("");
    });

    it("should return full text even after scrolling", () => {
      const mc = new MarqueeController(10);
      mc.setText("kleine-gateway");
      for (let i = 0; i < MARQUEE_PAUSE_TICKS + 2; i++) mc.tick();
      expect(mc.getFullText()).toBe("kleine-gateway");
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────

  describe("constants", () => {
    it("MARQUEE_PAUSE_TICKS should be 3", () => {
      expect(MARQUEE_PAUSE_TICKS).toBe(3);
    });

    it("MARQUEE_SEPARATOR should be two spaces, bullet, two spaces", () => {
      expect(MARQUEE_SEPARATOR).toBe("  \u2022  ");
      expect(MARQUEE_SEPARATOR.length).toBe(5);
    });
  });
});
