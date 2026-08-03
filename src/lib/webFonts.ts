import type { WebFont, WebFontFace } from "../types";
import { deleteFontFiles, loadFontFiles, saveFontFile } from "./db";

/**
 * Player-added Google Web Fonts (Settings → Appearance → Font).
 *
 * The two bundled faces are vendored under `src/fonts/` because the packaged
 * APK plays offline. An added font is held to the same standard: pressing Add
 * DOWNLOADS the woff2 files once and stores them in IndexedDB, and every launch
 * after that reads them back from the device. A `<link>` to
 * fonts.googleapis.com would have been twenty lines instead of this file, but it
 * would give an added font the opposite property from the bundled ones —
 * present on wifi, silently gone on a train, on every launch.
 *
 * Once downloaded, an added font joins the same one-attribute mechanism the
 * bundled ones use: `data-font="<id>"` on <html> repoints `--font-mono`. Nothing
 * downstream of that token knows the difference.
 */

/** Where the css2 stylesheet comes from. */
const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";

/**
 * Subsets kept from a family, matching what the bundled faces ship. Character
 * and location names are player-authored, so accented Latin is ordinary input
 * here rather than an edge case; anything outside both falls through to the
 * platform stack, exactly as it does for VT323 and Jersey 15.
 */
const KEPT_SUBSETS = ["latin", "latin-ext"];

/**
 * Ceilings on what one Add may pull down. A family with dozens of subsets (or a
 * CJK face) would otherwise fill the device for a font the player is trying
 * out. Exceeding either is a loud failure, not a silent truncation.
 */
export const MAX_FONT_FACES = 4;
export const MAX_FONT_BYTES = 2_000_000;

/** The tail every `--font-mono` list ends with — see `theme.css`. */
const PLATFORM_STACK = `ui-monospace, "SFMono-Regular", Menlo, monospace`;

/** The single injected stylesheet holding every added font's rules. */
const STYLE_ID = "loom-web-fonts";

/**
 * Tidy a typed family name.
 *
 * Google's css2 endpoint is case-sensitive and 400s on a mismatch, so an
 * all-lowercase entry — the overwhelmingly common typo — is title-cased as a
 * courtesy. Anything with capitals in it is sent as typed: "Press Start 2P" is
 * a real family name and no rule we could write would produce it from "press
 * start 2p" without breaking something else.
 */
export function normalizeFamily(input: string): string {
  const collapsed = input.trim().replace(/\s+/g, " ");
  if (!collapsed || /[A-Z]/.test(collapsed)) return collapsed;
  return collapsed.replace(/(^|\s)(\S)/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

/**
 * The `data-font` value and IndexedDB key prefix for a family. Lowercase and
 * alphanumeric so it is safe in both an attribute selector and a key.
 */
export function slugFamily(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The css2 request for a family. */
export function cssUrl(family: string): string {
  return `${CSS_ENDPOINT}?family=${encodeURIComponent(family)}&display=swap`;
}

/**
 * Google's own spelling of the family, read off the stylesheet it returned.
 * Preferred over what the player typed so the stored name and the CSS
 * `font-family` can never disagree.
 */
export function parseFamily(css: string): string | null {
  const m = /font-family:\s*(['"])(.+?)\1/.exec(css);
  return m ? m[2] : null;
}

/**
 * Pull the `@font-face` blocks out of a css2 response.
 *
 * The response is a run of blocks, each preceded by a CSS comment naming its
 * subset ("latin"). That comment is the only place the subset appears, so it is
 * what the latin/latin-ext filter reads — and when it is absent (a shape change
 * on Google's side) the caller falls back to taking the first few blocks rather
 * than failing on a stylesheet that is otherwise perfectly good.
 */
export function parseFontFaces(css: string): WebFontFace[] {
  const blocks = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  const out: WebFontFace[] = [];
  for (const m of css.matchAll(blocks)) {
    const body = m[2];
    const url = /src:[^;]*?url\((['"]?)(https?:\/\/[^)'"]+)\1\)/.exec(body);
    if (!url) continue;
    const range = /unicode-range:\s*([^;]+)/.exec(body);
    out.push({
      subset: (m[1] ?? "").trim(),
      unicodeRange: range ? range[1].trim() : "",
      url: url[2],
    });
  }
  return out;
}

/**
 * The faces actually worth downloading: latin + latin-ext when the stylesheet
 * labelled its blocks, otherwise the first `MAX_FONT_FACES` of whatever it sent.
 */
export function selectFaces(faces: WebFontFace[]): WebFontFace[] {
  const kept = faces.filter((f) => KEPT_SUBSETS.includes(f.subset));
  return (kept.length ? kept : faces).slice(0, MAX_FONT_FACES);
}

/**
 * The CSS for one added font: its `@font-face` rules pointed at local object
 * URLs, plus the `data-font` rule that repoints `--font-mono` — the same hook
 * `theme.css` uses for the bundled faces.
 *
 * No `size-adjust`: the bundled faces carry one because they were measured
 * against the platform stack, and there is nothing to measure an arbitrary
 * family against. The pixel-precise Text Size control is the answer to that.
 */
export function fontFaceCss(font: WebFont, urls: string[]): string {
  const family = JSON.stringify(font.family);
  const rules = urls
    .map((url, i) => {
      const stored = font.ranges[i];
      const range = stored ? `\n  unicode-range: ${stored};` : "";
      return [
        `@font-face {`,
        `  font-family: ${family};`,
        `  font-style: normal;`,
        `  font-weight: 400;`,
        `  font-display: swap;`,
        `  src: url(${url}) format("woff2");${range}`,
        `}`,
      ].join("\n");
    })
    .join("\n");
  return `${rules}\n:root[data-font="${font.id}"] {\n  --font-mono: ${family}, ${PLATFORM_STACK};\n}`;
}

/* ------------------------------------------------------------------ *
 * Everything below touches the network, IndexedDB or the document.
 * ------------------------------------------------------------------ */

/**
 * Object URLs currently minted per font id. Held so a removed font's URLs can
 * be revoked, and so re-rendering the stylesheet never mints a second set for a
 * font already loaded.
 */
const loaded = new Map<string, string[]>();

function styleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  document.head.appendChild(el);
  return el;
}

/** Re-render the injected stylesheet from whatever is currently loaded. */
function render(fonts: WebFont[]): void {
  const css = fonts
    .map((font) => {
      const urls = loaded.get(font.id);
      return urls?.length ? fontFaceCss(font, urls) : "";
    })
    .filter(Boolean)
    .join("\n\n");
  styleElement().textContent = css;
}

function release(id: string): void {
  const urls = loaded.get(id);
  if (!urls) return;
  for (const url of urls) URL.revokeObjectURL(url);
  loaded.delete(id);
}

/**
 * Download a family and store its files. Returns the `WebFont` to record in
 * settings; throws with a player-readable reason on anything that goes wrong,
 * because a font that quietly failed to arrive looks identical to one that was
 * never added.
 */
export async function downloadWebFont(input: string): Promise<WebFont> {
  const requested = normalizeFamily(input);
  if (!requested) throw new Error("Type a font name first.");

  let res: Response;
  try {
    res = await fetch(cssUrl(requested));
  } catch {
    throw new Error("Could not reach Google Fonts — check the connection.");
  }
  if (res.status === 400) {
    throw new Error(`No Google font called "${requested}" — check the spelling on fonts.google.com.`);
  }
  if (!res.ok) throw new Error(`Google Fonts returned ${res.status}.`);

  const css = await res.text();
  const faces = selectFaces(parseFontFaces(css));
  if (!faces.length) throw new Error(`No usable font files for "${requested}".`);

  const family = parseFamily(css) ?? requested;
  const id = slugFamily(family);
  if (!id) throw new Error(`"${requested}" is not a usable font name.`);

  // Fetch first, store second: a family that blows the size cap half way
  // through must not leave orphaned files behind under its id.
  const blobs: Blob[] = [];
  let bytes = 0;
  for (const face of faces) {
    const file = await fetch(face.url);
    if (!file.ok) throw new Error(`Could not download "${family}" (${file.status}).`);
    const blob = await file.blob();
    bytes += blob.size;
    if (bytes > MAX_FONT_BYTES) {
      throw new Error(`"${family}" is too large to store on device.`);
    }
    blobs.push(blob);
  }

  await deleteFontFiles(id);
  await Promise.all(blobs.map((blob, i) => saveFontFile(id, i, blob)));

  // Drop any previously mounted copy so the next render picks up the new files
  // rather than the object URLs of the old ones.
  release(id);
  loaded.set(id, blobs.map((b) => URL.createObjectURL(b)));

  return { family, id, ranges: faces.map((f) => f.unicodeRange) };
}

/**
 * Mount every added font: read its files back out of IndexedDB, mint object
 * URLs and inject the stylesheet. Called once on hydrate and again whenever the
 * list changes.
 *
 * A font whose files are missing is skipped rather than throwing — it simply
 * never gets a `data-font` rule, and `fontTheme` has already made sure a
 * selection with nothing behind it lands on the platform stack.
 */
export async function mountWebFonts(fonts: WebFont[]): Promise<void> {
  const wanted = new Set(fonts.map((f) => f.id));
  for (const id of [...loaded.keys()]) {
    if (!wanted.has(id)) release(id);
  }

  for (const font of fonts) {
    if (loaded.has(font.id)) continue;
    try {
      const blobs = await loadFontFiles(font.id);
      if (!blobs.length) continue;
      loaded.set(font.id, blobs.map((b) => URL.createObjectURL(b)));
    } catch {
      // A single unreadable font must not stop the others mounting.
    }
  }

  render(fonts);
}

/** Forget an added font: revoke its URLs, delete its files, re-render. */
export async function unmountWebFont(id: string, remaining: WebFont[]): Promise<void> {
  release(id);
  render(remaining);
  await deleteFontFiles(id);
}
