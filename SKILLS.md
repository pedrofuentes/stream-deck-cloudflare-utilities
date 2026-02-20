# Skills — Stream Deck Plugin UI/UX Design

Accumulated knowledge for AI agents working on Stream Deck plugins. This file
captures research, conventions, and best practices that should be reused across
sessions.

---

## 1. Key Display — `setImage` with Dynamic SVGs

The most effective way to display rich, readable information on a Stream Deck
key is to **generate an SVG at runtime and pass it via `setImage`**, rather than
relying solely on `setTitle`.

### Why not `setTitle` alone?

| Problem | Detail |
|---|---|
| **Tiny font** | Default title font is small and hard to read on 72×72 px keys |
| **No styling** | Cannot control font size, color, weight, or alignment per-line |
| **Emoji rendering** | Emoji like 🟢 render inconsistently across platforms and sizes |
| **No background** | Title renders _on top of_ the key image; you can't color-code the background |
| **Line limit** | Only ~3 short lines fit legibly |

### How `setImage` with SVG works

```typescript
const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="16" fill="#1a1a2e"/>
    <text x="72" y="60" text-anchor="middle" fill="#fff" font-size="18" font-family="Arial">
      my-worker
    </text>
  </svg>`;

await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
```

### Key constraints

- **Canvas size**: 72×72 px (144×144 high DPI). Always design for 144×144.
- **SVG is recommended**: Vectorized, scales well, supports text and shapes natively.
- **PNG/JPEG/WEBP** via base64 data URL also supported.
- **No animated formats** (GIF not supported for `setImage`).
- **Max 10 updates/second** per key.
- **Title overlays image**: When using `setImage`, set `ShowTitle` to `false`
  in the manifest state, or set an empty title. Otherwise the default title
  renders on top.

### SVG design patterns for OLED displays

| Principle | Guideline |
|---|---|
| **High contrast** | Use light text (#fff) on dark backgrounds (#0d1117). OLED blacks are true black. |
| **Large font** | Primary info ≥ 30px, secondary ≥ 18px, metadata ≥ 15px (at 144×144). Tested on hardware. |
| **Accent bar > dot** | A full-width colored bar (6px) at the top is far more visible than a small colored dot. Proven on device. |
| **Center everything** | `text-anchor="middle"` with `x="72"` — balanced on tiny screens, no wasted space. |
| **Minimal text** | Max 3 lines; abbreviate aggressively (e.g., "2h" not "2 hours ago"). |
| **Rounded shapes** | rx/ry on rects feel native to Stream Deck aesthetic |
| **No thin strokes** | At 72px, 1px strokes disappear. Minimum 2px, prefer fills. |
| **Font stack** | `font-family="Arial,Helvetica,sans-serif"` — safe cross-platform |
| **Bold for status** | `font-weight="bold"` on the main status line (line2) for maximum legibility. |
| **Test on hardware** | OLED displays have different gamma than monitors; always verify on device. |

### Layout template (144×144) — Accent Bar Design (PROVEN)

This design was tested on hardware and confirmed to be highly readable:

```
┌════════════════════════┐  ← colored accent bar (6px, full width)
│                        │
│    Worker Name (18px)  │  ← line 1: identifier, gray, centered
│                        │
│      STATUS (30px)     │  ← line 2: main info, white, bold, centered
│                        │
│    wrangler (15px)     │  ← line 3: metadata, gray, centered
│                        │
└────────────────────────┘
```

**Why accent bar beats status dot:**
- Dot was too small (7px radius) — barely visible on 72×72 OLED
- Bar spans full width — visible at any viewing angle and distance
- Bar leaves text area unobstructed — all text is centered
- Color fills the top edge of the key, acting like a tab indicator

### Vertical positioning by line count

| Lines | line1 Y | line2 Y | line3 Y |
|---|---|---|---|
| 3 lines (name + status + detail) | 46 | 88 | 124 |
| 2 lines (name + status) | 56 | 100 | — |
| 2 lines (status + detail) | — | 70 | 112 |
| 1 line (status only) | — | 86 | — |

---

## 2. Manifest `States` Configuration

### Disable default title overlay

When your plugin draws everything via `setImage`, set `ShowTitle: false` in the
manifest state and `UserTitleEnabled: false` at the **Action level** (sibling of
`States`, not inside it) so users don't accidentally overlay text.

```json
{
  "States": [
    {
      "Image": "imgs/actions/my-action",
      "ShowTitle": false
    }
  ],
  "UserTitleEnabled": false
}
```

### Font & title properties (if using `setTitle`)

Available in the manifest `States` entry:

- `FontFamily`: string
- `FontSize`: number (default is ~13)
- `FontStyle`: `""` | `"Bold"` | `"Italic"` | `"Bold Italic"` | `"Regular"`
- `FontUnderline`: boolean
- `TitleAlignment`: `"top"` | `"middle"` | `"bottom"`
- `TitleColor`: hex string (e.g., `"#ffffff"`)

---

## 3. Action & Plugin Icons (for the action list)

| Icon type | Size | High DPI | Format |
|---|---|---|---|
| **Plugin icon** (marketplace) | 256×256 | 512×512 | PNG |
| **Category icon** | 28×28 | 56×56 | SVG recommended |
| **Action icon** (action list) | 20×20 | 40×40 | SVG recommended |
| **Key icon** (state image) | 72×72 | 144×144 | SVG recommended |

### Action list icon guidelines

- **Monochromatic** with **white stroke** (#FFFFFF) on transparent background.
- Stream Deck auto-adjusts the color for light/dark contexts.
- **No solid backgrounds** on action list icons.
- **No colors** in list icons (color is only for key icons).
- SVG is strongly recommended over PNG for scaling.

---

## 4. Property Inspector (PI) Guidelines

### sdpi-components library

Use the Elgato `sdpi-components` UI library for consistent styling.

**Recommended**: Download locally for offline support:

```html
<script src="sdpi-components.js"></script>
```

**Remote** (development only):

```html
<link rel="stylesheet" href="https://sdpi-components.dev/releases/v3/sdpi-components.css"/>
<script src="https://sdpi-components.dev/releases/v3/sdpi-components.js"></script>
```

### Available components

| Component | Tag |
|---|---|
| Button | `<sdpi-button>` |
| Checkbox | `<sdpi-checkbox>` |
| Checkbox List | `<sdpi-checkbox-list>` |
| Color Picker | `<sdpi-color>` |
| Date Picker | `<sdpi-calendar type="date">` |
| File Picker | `<sdpi-file>` |
| Password | `<sdpi-password>` |
| Radio | `<sdpi-radio>` |
| Range / Slider | `<sdpi-range>` |
| Select / Dropdown | `<sdpi-select>` |
| Textarea | `<sdpi-textarea>` |
| Textfield | `<sdpi-textfield>` |

### PI design rules

| Requirement | Detail |
|---|---|
| **Auto-save** | Settings save on change via `setting="propertyName"` attribute. No "Save" button. |
| **Checkbox for booleans** | Not a dropdown or radio. |
| **Select or radio for enums** | Not a text field. |
| **Validation feedback** | Show inline errors / highlights. |
| **Setup help** | Provide concise help inline (collapsible details, tooltips). |
| **No donation/sponsor links** | Use Marketplace page instead. |
| **No copyright text** | Use Marketplace page instead. |
| **Keep it simple** | Avoid "lots" of components. Split into smaller actions if needed. |
| **Hide by default** | If using one PI for multiple actions, hide unused sections on load to prevent flicker. |
| **No large paragraphs** | Space is limited. |

---

## 5. Feedback Patterns

| Scenario | Method |
|---|---|
| Action succeeded (no visual change) | `ev.action.showOk()` |
| Action failed | `ev.action.showAlert()` + log entry |
| Visual state already changed | Do **not** use `showOk` (redundant) |
| Loading state | Show a subtle loading indicator via `setImage` |

---

## 6. SVG Color Palette (defined in `key-image-renderer.ts`)

All colors are exported as `STATUS_COLORS`, `BG_COLOR`, `TEXT_PRIMARY`, `TEXT_SECONDARY`.

| Role | Constant | Hex | Usage |
|---|---|---|---|
| OK / Live | `STATUS_COLORS.green` | `#4ade80` | Healthy, deployed, running |
| Warning / Minor | `STATUS_COLORS.amber` | `#fbbf24` | Degraded, minor issue |
| Error / Critical | `STATUS_COLORS.red` | `#f87171` | Down, failed, critical |
| Recent / Active | `STATUS_COLORS.blue` | `#60a5fa` | Recently changed, in progress |
| Gradual / Partial | `STATUS_COLORS.orange` | `#fb923c` | Gradual rollout, split traffic |
| Neutral / Unknown | `STATUS_COLORS.gray` | `#9ca3af` | Unknown, N/A, placeholder |
| Key background | `BG_COLOR` | `#0d1117` | Dark navy, matches OLED black |
| Main text | `TEXT_PRIMARY` | `#ffffff` | High contrast on dark background |
| Secondary text | `TEXT_SECONDARY` | `#9ca3af` | Metadata, labels, timestamps |

**Import from the renderer**, do not hardcode hex values in action files.

---

## 7. Existing Key Image Renderer — USE THIS

**Do NOT create a new renderer.** Use the existing `src/services/key-image-renderer.ts`.

```typescript
import { renderKeyImage, renderPlaceholderImage, STATUS_COLORS } from "../services/key-image-renderer";

// Render a status key with accent bar
const image = renderKeyImage({
  line1: "my-worker",       // optional: identifier (18px, gray, centered)
  line2: "2h ago",          // required: main status (30px, white, bold, centered)
  line3: "wrangler",        // optional: metadata (15px, gray, centered)
  statusColor: STATUS_COLORS.green,  // accent bar color
});
await ev.action.setImage(image);

// Placeholder for unconfigured actions
await ev.action.setImage(renderPlaceholderImage());  // shows "..."
```

### Available colors in `STATUS_COLORS`

| Key | Hex | Use for |
|---|---|---|
| `green` | `#4ade80` | OK, live, healthy |
| `amber` | `#fbbf24` | Warning, minor issue |
| `red` | `#f87171` | Error, critical, down |
| `blue` | `#60a5fa` | Recent, active, in progress |
| `orange` | `#fb923c` | Gradual rollout, partial |
| `gray` | `#9ca3af` | Unknown, N/A, placeholder |

### What the renderer generates

- 144×144 SVG with dark background (`#0d1117`), 16px corner radius
- **6px colored accent bar** at the top (full width) — the status indicator
- Up to 3 lines of centered text with automatic vertical spacing
- Returns `data:image/svg+xml,...` string ready for `setImage()`
- All text is XML-escaped automatically

### Extending the renderer

If a new action needs a different layout, **add a new function** to
`key-image-renderer.ts` rather than duplicating SVG generation in the action.
Keep the accent bar pattern consistent across all actions for visual coherence.

---

## 8. Stream Deck Device Key Sizes

| Device | Keys | Key resolution |
|---|---|---|
| Stream Deck Mini | 6 | 72×72 px |
| Stream Deck MK.2 | 15 | 72×72 px |
| Stream Deck XL | 32 | 96×96 px |
| Stream Deck + | 8 keys + 4 dials | 120×120 px (keys), 200×100 px (touch strip) |
| Stream Deck Neo | 8 keys | 72×72 px |

**Recommendation**: Design for 144×144 (high DPI of 72×72). Stream Deck
automatically scales down. SVGs handle all resolutions natively.

---

## 9. `setImage` + `setTitle` Interaction

| Combo | Result |
|---|---|
| `setImage` only | Image fills key; no title overlay |
| `setTitle` only | Title renders on top of manifest default image |
| Both | Title renders on top of the image |
| `setImage` + manifest `ShowTitle: false` | Clean image, no title overlay even if user tries to set one |

**Best practice**: Use `setImage` with baked-in text for full control. Set
`ShowTitle: false` in the manifest.

---

## 10. Design Decisions Log

Record of what was tried, what worked, and what didn't. **Read this before
making UI changes** to avoid repeating mistakes.

### Attempt 1: `setTitle` with emoji (REJECTED)

```
my-worke
🟢 2h ago
wrangler
```

**Problems:**
- Emoji rendered as tiny, inconsistent glyphs across platforms
- Font was the SDK default (~13px) — unreadable on 72×72 OLED
- No control over color, weight, or alignment
- Only 3 short lines fit, all unstyled

**Verdict:** Never use `setTitle` for status display. Use `setImage`.

### Attempt 2: SVG with colored dot + left-aligned text (IMPROVED BUT SUBOPTIMAL)

```
┌──────────────────────┐
│  Worker Name (16px)  │
│ ● Status (22px)      │   ← 7px radius dot, text left-shifted
│  wrangler (13px)     │
└──────────────────────┘
```

**Problems:**
- Dot was 7px radius — barely visible on tiny OLED
- Text was left-offset to make room for the dot — wasted space
- Font sizes (16/22/13) were readable but not optimal
- Looked unbalanced

**Verdict:** Status dot too small for hardware. Text too small.

### Attempt 3: Accent bar + centered text (CURRENT — APPROVED)

```
┌════════════════════════┐  ← 6px colored bar, full width
│                        │
│    Worker Name (18px)  │  ← centered, gray
│                        │
│      STATUS (30px)     │  ← centered, bold, white
│                        │
│    wrangler (15px)     │  ← centered, gray
│                        │
└────────────────────────┘
```

**Why it works:**
- Bar spans full width — impossible to miss, even at a glance
- 30px bold status text is large and instantly readable
- All text centered — balanced, professional look on small key
- 18px/15px secondary text is legible without competing with status
- Dark background (#0d1117) provides excellent OLED contrast

**This is the pattern all future actions should follow.**

---

## 11. Marquee (Scrolling Text) for Long Names

When identifiers (gateway names, worker names) exceed the `maxVisible` character
limit (10 chars), a circular marquee scroll animates the name on the key.

### Implementation: `src/services/marquee-controller.ts`

- **Circular scroll**: text loops continuously with a separator gap (`"  •  "`)
  between repetitions, like a news ticker.
- **Pause at start**: `MARQUEE_PAUSE_TICKS = 3` ticks pause before each scroll cycle.
- **500ms tick interval**: set in the action, not the controller.
- **Framework-agnostic**: controller manages state only; action owns the timer.

### Key design decisions

| Decision | Rationale |
|---|---|
| Circular (not bounce-back) | Feels like a natural ticker; no jarring reverse |
| `"  •  "` separator (5 chars) | Matches the iCal plugin marquee; visually clear gap |
| 10-char visible window | Tested on 72×72 OLED — 10 chars at 18px font is the max that fits |
| Marquee continues across metric cycling | Position preserved when user presses key |
| Marquee resets on gateway change | Fresh start for new text |

### How to use in a new action

```typescript
import { MarqueeController } from "../services/marquee-controller";

private marquee = new MarqueeController(10);
private marqueeInterval: ReturnType<typeof setInterval> | null = null;

// After fetching data:
this.marquee.setText(gatewayName);
if (this.marquee.needsAnimation()) {
  this.marqueeInterval = setInterval(() => {
    if (this.marquee.tick()) {
      // re-render with this.marquee.getCurrentText()
    }
  }, 500);
}
```

---

## 12. Rate Limiting and Error Back-off

### HTTP 429 handling (`RateLimitError`)

- `cloudflare-ai-gateway-api.ts` detects 429 responses and throws `RateLimitError`.
- The error includes `retryAfterSeconds` parsed from the `Retry-After` header.
- Actions use a 90-second default back-off, or the server hint if longer.
- Cached data is preserved during transient errors — the key keeps showing
  the last good value instead of flashing "ERR".

### Polling intervals

| State | Interval |
|---|---|
| Normal | User-configured (default 60s) |
| After error | 90s (rate limit back-off) |
| After 429 with `Retry-After` | Server-hinted duration |

---

## 13. Global Settings (Shared Credentials)

API credentials are stored in Stream Deck's global settings rather than
per-action settings. This avoids duplicate token entry and enables a single
setup window shared by all actions.

### Architecture

1. **`global-settings-store.ts`**: In-memory store with pub/sub (`onGlobalSettingsChanged`).
2. **`plugin.ts`**: Loads on startup, listens for updates via `onDidReceiveGlobalSettings`.
3. **`setup.html`**: Shared UI window opened from any action's Property Inspector.
4. **Actions**: Subscribe to changes and re-initialize API clients automatically.

### Key rule
Never store `apiToken` or `accountId` in per-action settings. Always read from
`getGlobalSettings()`.

---

## 14. UserTitleEnabled Placement (CRITICAL)

`"UserTitleEnabled": false` must be placed at the **Action level** (sibling of
`States`), NOT inside individual `States` entries. Placing it inside `States`
has no effect — the SDK ignores it there.

```json
{
  "Name": "My Action",
  "States": [{ "Image": "imgs/actions/my-action", "ShowTitle": false }],
  "UserTitleEnabled": false,
  "UUID": "com.pedrofuentes.cloudflare-utilities.my-action"
}
```

This was discovered through hardware testing. The SDK documentation is ambiguous
on placement.

---

## 15. Updating This Document

When you discover new patterns, SDK capabilities, or UX insights:

1. Add them to the relevant section above.
2. If it's a new category, create a new numbered section.
3. Keep entries concise — this is a reference, not a tutorial.
4. **Add failures to the Design Decisions Log** so they're not repeated.
