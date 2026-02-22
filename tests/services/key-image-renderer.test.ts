/**
 * Tests for the SVG key image renderer.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect } from "vitest";
import {
  renderKeyImage,
  renderPlaceholderImage,
  renderSetupImage,
  escapeXml,
  STATUS_COLORS,
  BG_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  type KeyImageOptions,
} from "../../src/services/key-image-renderer";

describe("key-image-renderer", () => {
  // ── escapeXml ────────────────────────────────────────────────────────────

  describe("escapeXml", () => {
    it("should escape ampersands", () => {
      expect(escapeXml("a&b")).toBe("a&amp;b");
    });

    it("should escape less-than signs", () => {
      expect(escapeXml("a<b")).toBe("a&lt;b");
    });

    it("should escape greater-than signs", () => {
      expect(escapeXml("a>b")).toBe("a&gt;b");
    });

    it("should escape double quotes", () => {
      expect(escapeXml('a"b')).toBe("a&quot;b");
    });

    it("should escape single quotes", () => {
      expect(escapeXml("a'b")).toBe("a&apos;b");
    });

    it("should escape multiple special characters in one string", () => {
      expect(escapeXml('<"hello" & \'world\'>')).toBe(
        "&lt;&quot;hello&quot; &amp; &apos;world&apos;&gt;"
      );
    });

    it("should return empty string unchanged", () => {
      expect(escapeXml("")).toBe("");
    });

    it("should leave strings without special characters unchanged", () => {
      expect(escapeXml("hello world 123")).toBe("hello world 123");
    });

    it("should handle strings that are entirely special characters", () => {
      expect(escapeXml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&apos;");
    });
  });

  // ── renderKeyImage ───────────────────────────────────────────────────────

  describe("renderKeyImage", () => {
    it("should return a data URI starting with data:image/svg+xml,", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should produce valid SVG with 144×144 dimensions", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain('width="144"');
      expect(svg).toContain('height="144"');
      expect(svg).toContain('viewBox="0 0 144 144"');
    });

    it("should include the background color", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain(`fill="${BG_COLOR}"`);
    });

    it("should use a custom background color when provided", () => {
      const result = renderKeyImage({
        line2: "OK",
        statusColor: STATUS_COLORS.green,
        bgColor: "#ff0000",
      });
      const svg = decodeSvg(result);
      expect(svg).toContain('fill="#ff0000"');
    });

    it("should include the status color as an accent bar", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.amber });
      const svg = decodeSvg(result);
      expect(svg).toContain(`fill="${STATUS_COLORS.amber}"`);
      // Accent bar is a rect, not a circle
      const rects = svg.match(/<rect /g) ?? [];
      expect(rects.length).toBeGreaterThanOrEqual(2); // bg rect + accent bar rect
    });

    it("should render line2 text", () => {
      const result = renderKeyImage({ line2: "Live", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain("Live");
      expect(svg).toContain(`fill="${TEXT_PRIMARY}"`);
    });

    it("should render line1 when provided", () => {
      const result = renderKeyImage({
        line1: "my-api",
        line2: "OK",
        statusColor: STATUS_COLORS.green,
      });
      const svg = decodeSvg(result);
      expect(svg).toContain("my-api");
      expect(svg).toContain(`fill="${TEXT_SECONDARY}"`);
    });

    it("should not render line1 when omitted", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      // Should have only one <text element (for line2), no line1 text
      const textElements = svg.match(/<text /g) ?? [];
      expect(textElements.length).toBe(1);
    });

    it("should render line3 when provided", () => {
      const result = renderKeyImage({
        line2: "OK",
        line3: "wrangler",
        statusColor: STATUS_COLORS.green,
      });
      const svg = decodeSvg(result);
      expect(svg).toContain("wrangler");
    });

    it("should not render line3 when omitted", () => {
      const result = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      const textElements = svg.match(/<text /g) ?? [];
      expect(textElements.length).toBe(1);
    });

    it("should render all 3 lines when provided", () => {
      const result = renderKeyImage({
        line1: "my-api",
        line2: "2m ago",
        line3: "dashboard",
        statusColor: STATUS_COLORS.blue,
      });
      const svg = decodeSvg(result);
      expect(svg).toContain("my-api");
      expect(svg).toContain("2m ago");
      expect(svg).toContain("dashboard");
      const textElements = svg.match(/<text /g) ?? [];
      expect(textElements.length).toBe(3);
    });

    it("should escape special characters in line1", () => {
      const result = renderKeyImage({
        line1: "a<b&c",
        line2: "OK",
        statusColor: STATUS_COLORS.green,
      });
      const svg = decodeSvg(result);
      expect(svg).toContain("a&lt;b&amp;c");
      expect(svg).not.toContain("a<b&c");
    });

    it("should escape special characters in line2", () => {
      const result = renderKeyImage({ line2: "x>y", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain("x&gt;y");
    });

    it("should escape special characters in line3", () => {
      const result = renderKeyImage({
        line2: "OK",
        line3: '"test"',
        statusColor: STATUS_COLORS.green,
      });
      const svg = decodeSvg(result);
      expect(svg).toContain("&quot;test&quot;");
    });

    it("should handle empty string for line1", () => {
      const result = renderKeyImage({ line1: "", line2: "OK", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      // Empty line1 should be treated as absent
      const textElements = svg.match(/<text /g) ?? [];
      expect(textElements.length).toBe(1);
    });

    it("should handle empty string for line3", () => {
      const result = renderKeyImage({ line2: "OK", line3: "", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      const textElements = svg.match(/<text /g) ?? [];
      expect(textElements.length).toBe(1);
    });

    it("should produce different output for different status colors", () => {
      const green = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.green });
      const red = renderKeyImage({ line2: "OK", statusColor: STATUS_COLORS.red });
      expect(green).not.toBe(red);
      expect(decodeSvg(green)).toContain(STATUS_COLORS.green);
      expect(decodeSvg(red)).toContain(STATUS_COLORS.red);
    });

    it("should use bold font-weight for line2", () => {
      const result = renderKeyImage({ line2: "Live", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain('font-weight="bold"');
    });

    it("should use font-size 30 for line2", () => {
      const result = renderKeyImage({ line2: "Live", statusColor: STATUS_COLORS.green });
      const svg = decodeSvg(result);
      expect(svg).toContain('font-size="30"');
    });
  });

  // ── renderPlaceholderImage ───────────────────────────────────────────────

  describe("renderPlaceholderImage", () => {
    it("should return a data URI starting with data:image/svg+xml,", () => {
      const result = renderPlaceholderImage();
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should produce valid SVG with 144×144 dimensions", () => {
      const svg = decodeSvg(renderPlaceholderImage());
      expect(svg).toContain('width="144"');
      expect(svg).toContain('height="144"');
    });

    it('should show "..." by default', () => {
      const svg = decodeSvg(renderPlaceholderImage());
      expect(svg).toContain("...");
    });

    it("should show custom text when provided", () => {
      const svg = decodeSvg(renderPlaceholderImage("Setup"));
      expect(svg).toContain("Setup");
    });

    it("should escape special characters", () => {
      const svg = decodeSvg(renderPlaceholderImage("<test>"));
      expect(svg).toContain("&lt;test&gt;");
    });

    it("should use the background color", () => {
      const svg = decodeSvg(renderPlaceholderImage());
      expect(svg).toContain(`fill="${BG_COLOR}"`);
    });

    it("should use the secondary text color", () => {
      const svg = decodeSvg(renderPlaceholderImage());
      expect(svg).toContain(`fill="${TEXT_SECONDARY}"`);
    });

    it("should handle empty string", () => {
      const svg = decodeSvg(renderPlaceholderImage(""));
      expect(svg).toContain("<text");
    });
  });

  // ── renderSetupImage ─────────────────────────────────────────────────────

  describe("renderSetupImage", () => {
    it("should return a data URI starting with data:image/svg+xml,", () => {
      const result = renderSetupImage();
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should produce valid SVG with 144×144 dimensions", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain('width="144"');
      expect(svg).toContain('height="144"');
      expect(svg).toContain('viewBox="0 0 144 144"');
    });

    it('should display "Please" text', () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain("Please");
    });

    it('should display "Setup" text', () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain("Setup");
    });

    it("should use the background color", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain(`fill="${BG_COLOR}"`);
    });

    it("should use a gray accent bar", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain(`fill="${STATUS_COLORS.gray}"`);
    });

    it("should use primary color for Setup text (bold)", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain(`fill="${TEXT_PRIMARY}"`);
      expect(svg).toContain('font-weight="bold"');
    });

    it("should use secondary color for Please text", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain(`fill="${TEXT_SECONDARY}"`);
    });

    it("should include the 6px accent bar", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain('height="6"');
    });

    it("should center text horizontally", () => {
      const svg = decodeSvg(renderSetupImage());
      expect(svg).toContain('text-anchor="middle"');
      expect(svg).toContain('x="72"');
    });
  });

  // ── STATUS_COLORS ────────────────────────────────────────────────────────

  describe("STATUS_COLORS", () => {
    it("should have green, amber, red, blue, orange, gray", () => {
      expect(STATUS_COLORS.green).toBeDefined();
      expect(STATUS_COLORS.amber).toBeDefined();
      expect(STATUS_COLORS.red).toBeDefined();
      expect(STATUS_COLORS.blue).toBeDefined();
      expect(STATUS_COLORS.orange).toBeDefined();
      expect(STATUS_COLORS.gray).toBeDefined();
    });

    it("should have valid hex color values", () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const color of Object.values(STATUS_COLORS)) {
        expect(color).toMatch(hexRegex);
      }
    });
  });

  // ── Constants ────────────────────────────────────────────────────────────

  describe("constants", () => {
    it("BG_COLOR should be a valid hex color", () => {
      expect(BG_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it("TEXT_PRIMARY should be white", () => {
      expect(TEXT_PRIMARY).toBe("#ffffff");
    });

    it("TEXT_SECONDARY should be a valid hex color", () => {
      expect(TEXT_SECONDARY).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decode a data URI to the raw SVG string for assertion convenience. */
function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  if (!dataUri.startsWith(prefix)) {
    throw new Error(`Expected data URI, got: ${dataUri.slice(0, 40)}`);
  }
  return decodeURIComponent(dataUri.slice(prefix.length));
}
