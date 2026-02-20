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
 *   ┌──────────────────────┐
 *   │                      │
 *   │   line1 (16px)       │   ← identifier, dimmed
 *   │                      │
 *   │  ● line2 (22px)      │   ← main status, bold, with colored dot
 *   │                      │
 *   │   line3 (13px)       │   ← metadata, dimmed
 *   │                      │
 *   └──────────────────────┘
 */
export function renderKeyImage(options: KeyImageOptions): string {
  const bg = options.bgColor ?? BG_COLOR;
  const line1 = options.line1 ? escapeXml(options.line1) : "";
  const line2 = escapeXml(options.line2);
  const line3 = options.line3 ? escapeXml(options.line3) : "";

  // Vertical positioning: center the content block
  // With line1 + line2 + line3: y positions 38, 80, 118
  // Without line1: y positions shift up
  const hasLine1 = !!options.line1;
  const hasLine3 = !!options.line3;

  const line1Y = 38;
  const line2Y = hasLine1 ? 80 : 72;
  const dotY = line2Y;
  const line3Y = hasLine3 ? (hasLine1 ? 118 : 110) : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${bg}"/>
  ${hasLine1 ? `<text x="72" y="${line1Y}" text-anchor="middle" fill="${TEXT_SECONDARY}" font-size="16" font-family="Arial,Helvetica,sans-serif">${line1}</text>` : ""}
  <circle cx="18" cy="${dotY - 7}" r="7" fill="${options.statusColor}"/>
  <text x="32" y="${line2Y}" fill="${TEXT_PRIMARY}" font-size="22" font-weight="bold" font-family="Arial,Helvetica,sans-serif">${line2}</text>
  ${hasLine3 ? `<text x="72" y="${line3Y}" text-anchor="middle" fill="${TEXT_SECONDARY}" font-size="13" font-family="Arial,Helvetica,sans-serif">${line3}</text>` : ""}
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
