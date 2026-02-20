/**
 * SVG-based key image renderer for Stream Deck.
 *
 * Generates 144×144 SVG images with:
 * - Color-coded status indicator (dot or full background accent)
 * - Up to 3 lines of text with controlled sizing
 * - High contrast for OLED displays
 * - Safe XML escaping
 *
 * Usage:
 *   const dataUri = renderKeyImage({ ... });
 *   await ev.action.setImage(dataUri);
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

// ── Color Palette ──────────────────────────────────────────────────────────

export const STATUS_COLORS = {
  green: "#4ade80",
  amber: "#fbbf24",
  red: "#f87171",
  blue: "#60a5fa",
  orange: "#fb923c",
  gray: "#9ca3af",
} as const;

export const BG_COLOR = "#0d1117";
export const TEXT_PRIMARY = "#ffffff";
export const TEXT_SECONDARY = "#9ca3af";

// ── Types ──────────────────────────────────────────────────────────────────

export type KeyImageOptions = {
  /** Line 1: identifier / name (top of key) */
  line1?: string;
  /** Line 2: main status label (center, largest) */
  line2: string;
  /** Line 3: metadata / detail (bottom, smaller) */
  line3?: string;
  /** Status indicator color (hex) */
  statusColor: string;
  /** Background color (default: dark navy) */
  bgColor?: string;
};

// ── Renderer ───────────────────────────────────────────────────────────────

/**
 * Renders a data URI for a 144×144 SVG key image.
 *
 * Layout:
 *   ┌════════════════════════┐  ← colored accent bar (6 px)
 *   │                        │
 *   │     line1 (18px)       │  ← identifier, dimmed, centered
 *   │                        │
 *   │     LINE2 (30px)       │  ← main status, bold, white, centered
 *   │                        │
 *   │     line3 (15px)       │  ← metadata, dimmed, centered
 *   │                        │
 *   └────────────────────────┘
 *
 * The colored accent bar at the top replaces the small status dot,
 * making the status indicator far more visible on a tiny OLED screen.
 */
export function renderKeyImage(options: KeyImageOptions): string {
  const bg = options.bgColor ?? BG_COLOR;
  const line1 = options.line1 ? escapeXml(options.line1) : "";
  const line2 = escapeXml(options.line2);
  const line3 = options.line3 ? escapeXml(options.line3) : "";

  const hasLine1 = !!options.line1;
  const hasLine3 = !!options.line3;

  // Vertical centering depending on which lines are present
  // The accent bar occupies the top 6 px, so content starts below it.
  let line1Y: number, line2Y: number, line3Y: number;

  if (hasLine1 && hasLine3) {
    // 3-line layout
    line1Y = 46;
    line2Y = 88;
    line3Y = 124;
  } else if (hasLine1) {
    // 2-line: name + status
    line1Y = 56;
    line2Y = 100;
    line3Y = 0;
  } else if (hasLine3) {
    // 2-line: status + detail
    line1Y = 0;
    line2Y = 70;
    line3Y = 112;
  } else {
    // 1-line: status only
    line1Y = 0;
    line2Y = 86;
    line3Y = 0;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${bg}"/>
  <rect y="0" width="144" height="6" rx="3" fill="${options.statusColor}"/>
  ${hasLine1 ? `<text x="72" y="${line1Y}" text-anchor="middle" fill="${TEXT_SECONDARY}" font-size="18" font-family="Arial,Helvetica,sans-serif">${line1}</text>` : ""}
  <text x="72" y="${line2Y}" text-anchor="middle" fill="${TEXT_PRIMARY}" font-size="30" font-weight="bold" font-family="Arial,Helvetica,sans-serif">${line2}</text>
  ${hasLine3 ? `<text x="72" y="${line3Y}" text-anchor="middle" fill="${TEXT_SECONDARY}" font-size="15" font-family="Arial,Helvetica,sans-serif">${line3}</text>` : ""}
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Renders a minimal placeholder key (e.g., for unconfigured actions).
 */
export function renderPlaceholderImage(text = "..."): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${BG_COLOR}"/>
  <text x="72" y="80" text-anchor="middle" fill="${TEXT_SECONDARY}" font-size="20" font-family="Arial,Helvetica,sans-serif">${escapeXml(text)}</text>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Escapes special XML characters in a string for safe SVG embedding.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
