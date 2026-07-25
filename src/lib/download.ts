/**
 * Getting a stored image blob out of the app and onto the device.
 *
 * Two paths, because the app ships as both a web build and an APK:
 *   - Web Share (`navigator.share` with files) when the platform offers it —
 *     the only route that reaches the Android share/save sheet from a WebView.
 *   - An `<a download>` click otherwise — desktop browsers' native save.
 *
 * A user-cancelled share is a completed action, not a failure: it must not fall
 * through to the anchor. Everything else falls back, so a platform that
 * advertises share but throws still saves the file.
 */

/** Longest filename stem we emit — long character names get truncated, not rejected. */
const MAX_STEM = 48;

/**
 * `Ilse the Grey` → `loom-ilse-the-grey-portrait.png`. Anything that isn't
 * `[a-z0-9]` collapses to a single dash so the name is safe on every
 * filesystem; a name with nothing usable in it falls back to `character`.
 */
export function imageFileName(name: string, suffix = "portrait", ext = "png"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_STEM)
    .replace(/-+$/g, "");
  return `loom-${slug || "character"}-${suffix}.${ext}`;
}

/** The share half of `navigator` — both members are optional off the web. */
interface FileShareNavigator {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

/**
 * Save a blob to the device as `filename`. Resolves once the save has been
 * handed off (or the user dismissed the share sheet); throws only when neither
 * path is available, so callers can surface a failure indicator.
 */
export async function saveBlobAsFile(blob: Blob, filename: string): Promise<void> {
  const type = blob.type || "image/png";
  const nav: FileShareNavigator | undefined =
    typeof navigator === "undefined" ? undefined : (navigator as unknown as FileShareNavigator);

  if (nav?.share && typeof File !== "undefined") {
    const file = new File([blob], filename, { type });
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename });
        return;
      } catch (err) {
        // Dismissing the sheet is a decision — don't second-guess it with a
        // download. Any other error means share didn't work: fall through.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
  }

  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Saving files isn't supported here.");
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoking immediately can race the download on some engines; one tick is
    // enough for the click to have taken the URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
