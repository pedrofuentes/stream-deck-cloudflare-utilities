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
| **High contrast** | Use light text (#fff, #e0e0e0) on dark backgrounds (#1a1a2e, #0d1117) |
| **Large font** | Primary info ≥ 18px, secondary ≥ 13px, minimum legible ≥ 11px (at 144×144) |
| **Status color as accent** | Use colored circles, bars, or pill backgrounds instead of emoji |
| **Minimal text** | Max 3 lines; abbreviate aggressively (e.g., "2h ago" not "2 hours ago") |
| **Rounded shapes** | rx/ry on rects feel native to Stream Deck aesthetic |
| **No thin strokes** | At 72px, 1px strokes disappear. Minimum 2px, prefer fills. |
| **Font stack** | `font-family="Arial, Helvetica, sans-serif"` — safe cross-platform |
| **Test on hardware** | OLED displays have different gamma than monitors; check contrast on device |

### Layout template (144×144)

```
┌──────────────────────┐
│  [10px top padding]  │
│  Worker Name (18px)  │   ← line 1: truncated identifier
│                      │
│  ● Status (22px)     │   ← line 2: colored dot + status text (large)
│                      │
│  2h ago · wrangler   │   ← line 3: metadata (13px, dimmed)
│  [10px bot padding]  │
└──────────────────────┘
```

---

## 2. Manifest `States` Configuration

### Disable default title overlay

When your plugin draws everything via `setImage`, set `ShowTitle: false` and
`UserTitleEnabled: false` in the manifest state so users don't accidentally
overlay text.

```json
{
  "States": [
    {
      "Image": "imgs/actions/my-action",
      "ShowTitle": false,
      "UserTitleEnabled": false
    }
  ]
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

## 6. SVG Color Palette for Status Indicators

Designed for OLED readability:

| State | Color | Hex | Usage |
|---|---|---|---|
| OK / Live | Green | `#4ade80` | Healthy, deployed, running |
| Warning / Minor | Amber | `#fbbf24` | Degraded, minor issue |
| Error / Critical | Red | `#f87171` | Down, failed, critical |
| Recent / Active | Blue | `#60a5fa` | Recently changed, in progress |
| Gradual / Partial | Yellow/Orange | `#fb923c` | Gradual rollout, split traffic |
| Neutral / Unknown | Gray | `#9ca3af` | Unknown, N/A, placeholder |
| Background (dark) | Navy | `#0d1117` | Key background |
| Background (alt) | Dark blue | `#1a1a2e` | Alternative key background |
| Text primary | White | `#ffffff` | Main text |
| Text secondary | Light gray | `#9ca3af` | Metadata, timestamps |

---

## 7. SVG Helper Function Pattern

Create a reusable renderer in a service file:

```typescript
export function renderKeyImage(options: {
  line1: string;
  line2: string;
  line3?: string;
  statusColor: string;
  bgColor?: string;
}): string {
  const bg = options.bgColor ?? "#0d1117";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="16" fill="${bg}"/>
    <circle cx="20" cy="78" r="8" fill="${options.statusColor}"/>
    <text x="72" y="42" text-anchor="middle" fill="#fff" font-size="18" font-weight="bold" font-family="Arial,sans-serif">${escapeXml(options.line1)}</text>
    <text x="36" y="82" fill="#fff" font-size="20" font-weight="bold" font-family="Arial,sans-serif">${escapeXml(options.line2)}</text>
    ${options.line3 ? `<text x="72" y="120" text-anchor="middle" fill="#9ca3af" font-size="13" font-family="Arial,sans-serif">${escapeXml(options.line3)}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

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

## 10. Updating This Document

When you discover new patterns, SDK capabilities, or UX insights:

1. Add them to the relevant section above.
2. If it's a new category, create a new numbered section.
3. Keep entries concise — this is a reference, not a tutorial.
