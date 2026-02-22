# Elgato Marketplace Content — Agent Guide

> This document tells AI agents how to create, update, and maintain content for the
> Elgato Marketplace plugin listing at https://marketplace.elgato.com.

---

## Directory Structure

```
content/
├── CONTENT-GUIDE.md          # ← You are here. Agent instructions.
├── description.md            # Plugin description (4,000 char limit) — source of truth
├── release-notes.md          # Release notes per version (1,500 char limit each) — source of truth
├── marketplace-content.html  # Copy-paste ready HTML — open in browser, copy, paste into WYSIWYG editor
└── assets/
    ├── icon.svg              # Source SVG for the marketplace icon
    ├── icon.png              # Generated PNG (288×288, ≤2 MB)
    ├── thumbnail.svg         # Source SVG for the marketplace thumbnail
    ├── thumbnail.png         # Generated PNG (1920×960, ≤5 MB)
    ├── gallery-1-*.svg       # Source SVG for gallery image 1
    ├── gallery-1-*.png       # Generated PNG (1920×960, ≤10 MB)
    ├── gallery-2-*.svg       # Gallery image 2
    ├── gallery-2-*.png
    ├── gallery-3-*.svg       # Gallery image 3
    ├── gallery-3-*.png
    ├── gallery-4-*.svg       # Gallery image 4
    └── gallery-4-*.png
```

---

## Elgato Marketplace Asset Requirements

| Asset | Format | Size Limit | Dimensions | Count |
|-------|--------|-----------|------------|-------|
| Icon | PNG or JPG | 2 MB | 288×288 (1:1) | 1 |
| Thumbnail | PNG or JPG | 5 MB | 1920×960 (2:1) | 1 |
| Gallery | PNG/JPG ≤10 MB or MP4 ≤50 MB | see format | 1920×960 (PNG) or 1920×1080 (MP4) | Min 3 |
| Description | Plain text | 4,000 chars | — | 1 |
| Release Notes | Plain text | 1,500 chars | — | 1 per version |

---

## When to Update Content

### Every Release (MANDATORY)
1. **Release notes** — Add a new entry to `content/release-notes.md`
2. **Description** — Review and update if new actions or features were added

### When Actions Change
3. **Gallery images** — Update relevant gallery SVGs if key display changed
4. **Thumbnail** — Update if new actions were added (it shows all 4 keys)
5. **Icon** — Rarely needs updating (only for major branding changes)

### After Updating SVGs
6. **Regenerate PNGs** — Run `npm run content:assets` (see below)

---

## How to Write Release Notes

### Rules
- **Max 1,500 characters** per release
- Plain text (no markdown rendering on Elgato Marketplace)
- Lead with the most impactful change
- Use bullet points (• character) for lists
- Include version number and date as header
- Keep it user-facing — skip internal refactors unless they affect behavior
- Character count is noted at the bottom of each entry in `release-notes.md`

### Template
```
[Version] — [One-line summary]

[Optional paragraph with context]

• [Feature/fix 1] — [Brief description of what it does for the user]
• [Feature/fix 2] — [Brief description]
• [Fix 1] — [What was wrong and how it's fixed]

[Optional closing note about what's next]
```

### What to Include
- New features and actions
- Bug fixes that affected users
- UX improvements (better displays, new states, etc.)
- Performance improvements users would notice
- Breaking changes or requirement changes

### What to Exclude
- Internal refactors with no user impact
- Test improvements
- Documentation-only changes
- Dependency updates (unless they fix a user-visible bug)

### Updating the HTML Copy-Paste File
The Elgato Marketplace developer portal uses a WYSIWYG editor. Markdown won't paste correctly.

**After editing `description.md` or `release-notes.md`, you MUST also update `marketplace-content.html`** with matching HTML content. This file:
- Contains the description and all release notes as styled HTML
- Has tabs for each version's release notes
- Includes character counters
- The user opens it in a browser, selects the content box, copies, and pastes directly into the WYSIWYG editor with formatting intact

When adding a new release:
1. Add the new release notes entry to `release-notes.md` (source of truth)
2. Add a matching `<div class="tab-content">` section in `marketplace-content.html`
3. Add a new tab button in the `.tab-bar` div
4. Make the new version tab active by default (add `active` class, remove from previous)

---

## How to Update the Description

### Rules
- **Max 4,000 characters**
- Use emoji headings for visual structure (they render on the marketplace)
- Sections: Features (per action), workflow highlights, privacy, requirements, getting started
- Tone: Marketing/enthusiastic — highlight value propositions, use action words
- Keep action descriptions accurate to current behavior
- Update the "Last updated" header in `description.md`

### When Adding a New Action
1. Add a new subsection under "## 🔥 [N] Powerful Actions"
2. Update the action count in the heading
3. Describe what it shows, how to use it, and what metrics/states are available
4. If it introduces new features (new time ranges, new metric types, etc.), mention them in the "✨ Built for Your Workflow" section

---

## How to Regenerate PNG Assets

SVGs are the source of truth. PNGs are generated from SVGs.

```bash
npm run content:assets
```

This runs `scripts/convert-content-assets.ts` which:
1. Finds all `.svg` files in `content/assets/`
2. Converts each to PNG at native viewBox dimensions
3. Uses system fonts and high-quality rendering via `@resvg/resvg-js`

### Editing Gallery Images
- Edit the SVGs directly — they use the same color palette as the plugin
- Key mockups use the accent bar pattern from `UI-DESIGN-GUIDE.md`
- Colors: `#0d1117` (background), `#4ade80` (green), `#60a5fa` (blue), `#fbbf24` (amber), `#f87171` (red), `#fb923c` (orange), `#9ca3af` (gray), `#f6821f` (Cloudflare orange)
- Font: `'Segoe UI'` for UI text, `Arial` for key display text
- After editing, run `npm run content:assets` to regenerate PNGs

### Replacing Mockups with Real Screenshots
The gallery images are currently SVG mockups. When real device screenshots are available:
1. Place the photos in `content/assets/` as `gallery-N-*.png` (or `.jpg`)
2. Ensure dimensions are 1920×960 (2:1 ratio)
3. Keep the SVGs as documentation/backup
4. Keep file sizes under 10 MB per image

---

## Visual Design Language

All marketplace assets follow the Stream Deck dark theme:

| Element | Value |
|---------|-------|
| Background | `#0d1117` (dark navy) to `#161b22` (slightly lighter) gradient |
| Text primary | `#ffffff` |
| Text secondary | `#9ca3af` |
| Accent | `#f6821f` → `#fbad41` (Cloudflare orange gradient) |
| Status green | `#4ade80` |
| Status blue | `#60a5fa` |
| Status amber | `#fbbf24` |
| Status red | `#f87171` |
| Status orange | `#fb923c` |
| Key background | `#0d1117` with `#2d2d44` border |
| Key corner radius | 16–20px |
| Accent bar | 6–8px, full width, 3px corner radius |

---

## Release Workflow Checklist

When preparing a release, add this to your pre-release checklist:

```
□ Write release notes in content/release-notes.md
□ Review description.md — update if features changed
□ Update marketplace-content.html with matching HTML content
□ Update gallery SVGs if key display changed
□ Run: npm run content:assets (regenerate PNGs)
□ Verify PNG file sizes are within limits
□ Commit content/ changes with the version bump
□ After GitHub Release: open marketplace-content.html in browser, copy content, paste into Elgato Marketplace WYSIWYG
□ After GitHub Release: upload new assets to Elgato Marketplace (if changed)
```

---

## Elgato Marketplace Upload Procedure

After completing a GitHub release:

1. Go to https://marketplace.elgato.com (developer portal)
2. Find the **Cloudflare Utilities** plugin
3. Click **Edit** or **New Version**
4. **Release Notes**: Copy the plain text from `content/release-notes.md` for this version
5. **Description**: If updated, copy the full text from `content/description.md` (strip the markdown metadata header)
6. **Assets**: Upload new PNGs from `content/assets/` if any changed:
   - Icon: `content/assets/icon.png`
   - Thumbnail: `content/assets/thumbnail.png`
   - Gallery: `content/assets/gallery-*.png`
7. **Submit** for review

---

## FAQ for Agents

**Q: Do I need to update gallery images for every release?**
A: No. Only update them if key displays changed (new states, new metrics, visual redesign). Bug fixes and internal changes don't need gallery updates.

**Q: Can I add more than 4 gallery images?**
A: Yes. Elgato requires a minimum of 3. More is better for showcasing features. Add new `gallery-N-*.svg` files and regenerate.

**Q: What if the description exceeds 4,000 characters?**
A: Trim the least important sections. The "Getting Started" section can be shortened since users will have a README. Focus on features and value props.

**Q: Should release notes include every commit?**
A: No. Only user-facing changes. Group related commits into a single bullet point. See "What to Exclude" above.

**Q: What if I add a new action?**
A: Update description.md (new action section + action count), update thumbnail.svg (add the key), update gallery-1 (add to the "all actions" image), and regenerate PNGs.
