# Appearance settings — added fonts, pixel text size, custom colors

Date: 2026-08-03

Settings → Appearance today offers three fixed choices: a four-step text scale
(S/M/L/XL), a three-face font picker, and an Invert Colors toggle. Each one is a
closed list. This design opens all three: the player adds Google Web Fonts by
name, sets the reading size in real pixels, and picks the background and text
colors directly. Invert Colors is removed — it is one point in the color space
the pickers now cover, and it is kept reachable as a preset.

## 1. Google Web Fonts

### Data

```ts
/** A Google Web Font the player added by name. */
export interface WebFont {
  /** Family as Google spells it, e.g. "Silkscreen" — the CSS family name. */
  family: string;
  /** Slug of the family: the `data-font` value and the idb key prefix. */
  id: string;
}
```

`Settings.webFonts: WebFont[]`. `Settings.font` stays a string, now either a
`FontChoice` (`system` · `vt323` · `jersey15`) or an added font's `id`.

### Why the files are downloaded, not linked

The packaged APK plays offline; `theme.css` already says so, which is why VT323
and Jersey 15 are vendored under `src/fonts/` rather than linked. A `<link>` to
`fonts.googleapis.com` would give an added font the opposite property from the
bundled two — present on wifi, silently gone on a train. So an added font is
downloaded once and stored on device, and behaves like a bundled one from then
on.

### Add flow (`webFonts.ts → addWebFont`)

1. **Request the stylesheet.** `GET
   https://fonts.googleapis.com/css2?family=<Family>&display=swap`. A non-200 is
   the validation — Google returns 400 for a family it does not have — and the
   failure reaches the screen as text, not a badge. The family must be spelled
   as Google spells it; an all-lowercase entry is title-cased as a courtesy
   (`silkscreen` → `Silkscreen`), anything else is sent verbatim.
2. **Parse it.** `parseFontFaces(css)` — pure, tested — returns
   `{ subset, url, unicodeRange }[]` read off the `/* latin */` comments the
   css2 response puts before each `@font-face`. Keeps **latin + latin-ext**, the
   same pair the bundled faces ship, because character and location names are
   player-authored and accented Latin is ordinary input here. With no comments
   (a shape change on Google's side) it falls back to the first
   `MAX_FONT_FACES` blocks. A download over `MAX_FONT_BYTES` fails with a
   reason rather than filling the device.
3. **Store the blobs.** Each woff2 is fetched and written to a **new `fonts`
   object store** in `db.ts` under `font:<id>:<i>`. A new store rather than the
   existing `images` one: `images.ts` owns that keyspace and iterates it.
   `DB_VERSION` bumps, and the `upgrade` callback creates the store.
4. **Inject the CSS.** One `<style id="loom-web-fonts">` element holds, for every
   added font, its `@font-face` rules (`src: url(<blob object URL>)`, with the
   parsed `unicode-range`) and its
   `:root[data-font="<id>"] { --font-mono: "<family>", <platform stack> }` rule.
   That is the same one-attribute mechanism `data-font` already uses for the
   bundled faces, so nothing downstream of `--font-mono` changes.

### Boot and removal

`loadWebFonts()` reads `Settings.webFonts`, pulls each blob back out of idb,
mints object URLs and injects the same style element. Called once from the app's
hydrate path. An added font whose blobs are missing is skipped rather than
throwing — its `data-font` rule simply never lands and `--font-mono` keeps the
platform stack.

`removeWebFont(id)` drops the settings row and deletes the blobs. If the removed
font was the active one, `Settings.font` falls back to `system` in the same
update — otherwise the app would sit on a `data-font` value nothing defines.

`fontTheme` gains the added list as an argument: a stored id is valid if it is a
`FontChoice` **or** an added font's id, and anything else still degrades to
`system`.

### Known limit

The bundled faces carry `size-adjust` so a Text Size setting means the same
thing across them. An added font has no such measurement, so its apparent size
at a given pixel setting is whatever the designer drew. The screen says so; the
pixel control (below) is the fix the player already has.

## 2. Reading size in pixels

`Settings.textScale: TextScale` becomes `Settings.textSize: number` (pixels).
`TextScale` and `ChatView`'s `SCALE_CLASS` are deleted.

- Scope is unchanged: the narration log only. Buttons, labels and chrome keep
  their size, so a large setting buys prose and not a blown-up interface.
  `ChatView` applies `style={{ fontSize }}` to the same container the scale
  class sat on.
- `clampTextSize` sanitizes at READ time, like `normalizeDice` and the journal
  numbers, bounded to `MIN_TEXT_SIZE`…`MAX_TEXT_SIZE` (10–40).
- Migration: `{ s: 14, m: 16, l: 18, xl: 20 }` — the pixel values the old
  Tailwind classes already resolved to, so nobody's setting moves on upgrade.
- UI: `[−] 16 px [+]`, ±2 per press, both buttons disabled at their bound.

## 3. Background and text color

`Settings.invert: boolean` becomes `Settings.paper: string` and
`Settings.ink: string`, both `#rrggbb`.

- `normalizeHex` at READ time accepts `#rgb` / `#rrggbb` in any case and returns
  lowercase `#rrggbb`; anything else takes the default. A corrupted value can
  never leave the app with an unreadable screen and no way back to the settings.
- Migration: `invert ? { paper: "#000000", ink: "#ffffff" } : { paper:
  "#ffffff", ink: "#000000" }`.
- `App.tsx` sets `--ink` and `--paper` inline on `<html>` and derives the rest
  from them:
  - `--scrim` = ink at 60% alpha (the dice-toss backdrop, which has always been
    ink-derived per theme).
  - `color-scheme` and the `theme-color` meta from paper's relative luminance,
    so a dark-OS WebView still knows we own theming and skips its force-dark
    pass over the generated bitmaps.
- `theme.css` loses the `:root[data-theme="dark"]` block. `:root` keeps its
  black-on-white values as the pre-hydration fallback.
- The screen shows two `<input type="color">` rows (Background, Text) plus
  presets: **Ink on Paper** · **Paper on Ink** · **Amber CRT** · **Green CRT**.
  The first two are the old Invert toggle, one tap away, which is why removing
  it costs nothing.

### Deliberately unchanged

`Header` paints the location · day · menu labels in literal `#000`/`#fff` over
the banner art. That art is a real 1-bit bitmap the tokens never touched and
still do not; the labels stay literal for the same reason they always were.

## Files

New: `src/lib/webFonts.ts`, `src/lib/webFonts.test.ts`.

Edited: `src/types.ts` · `src/lib/defaults.ts` · `src/lib/settings.ts` (+test) ·
`src/lib/db.ts` · `src/store.ts` · `src/theme.css` · `src/App.tsx` ·
`src/components/ChatView.tsx` · `src/components/AppearanceScreen.tsx` ·
`src/components/MenuScreen.tsx` · `CLAUDE.md` · `DESIGN.md`.

## Testing

`webFonts.test.ts` covers the pure half: `parseFontFaces` over a real css2
response (subset comments, `unicode-range`, woff2 URL), the no-comment fallback,
the byte cap, and the family title-casing. `settings.test.ts` gains
`clampTextSize`, the `textScale` → `textSize` migration, `normalizeHex`, the
`invert` → paper/ink migration, scrim derivation, and `fontTheme` accepting an
added id while still rejecting an unknown one.
