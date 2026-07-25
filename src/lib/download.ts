/**
 * Getting a stored image blob out of the app and onto the device.
 *
 * Three paths, because the app ships as both a web build and an APK:
 *   - Capacitor (the APK): write the bytes to the app's cache directory, then
 *     hand the file URI to the native share sheet. The Android System WebView
 *     implements NEITHER `navigator.share` NOR blob `<a download>` — a WebView
 *     has no download manager — so on the APK both web paths below are silent
 *     no-ops and this is the only route that reaches the device.
 *   - Web Share (`navigator.share` with files) when the browser offers it.
 *   - An `<a download>` click otherwise — desktop browsers' native save.
 *
 * A user-cancelled share is a completed action, not a failure: it must not fall
 * through to the next path. Everything else falls back, so a platform that
 * advertises share but throws still saves the file.
 */

import { Capacitor } from "@capacitor/core";

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
 * A dismissed share sheet. The web API rejects with `AbortError`; Capacitor's
 * Share plugin rejects with a plain `Error("Share canceled")` (both platforms,
 * both spellings of "cancel"), so the message is all we have to go on.
 */
function isDismissal(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || /cancell?ed|dismiss/i.test(err.message);
}

/** Blob → bare base64 (no `data:` prefix) — what Filesystem.writeFile wants. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.onload = () => {
      const result = String(reader.result);
      // "data:image/png;base64,AAAA" → "AAAA"
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Native save: cache file + share sheet. Returns true once the file has been
 * handed off (or the sheet was dismissed), false when this isn't a native
 * build. Throws when the native path exists but failed, so the caller can
 * report it rather than falling through to two paths that cannot work here.
 *
 * The plugins are imported lazily so the web build never pulls them in.
 */
async function saveNative(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  // Cache, not Documents: the public Documents folder is unwritable on Android
  // 11+, while the cache dir needs no permission and is exposed to the share
  // sheet through Capacitor's FileProvider. The user picks the real
  // destination (Files, Photos, Drive, …) from the sheet.
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });

  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: "Save image" });
  } catch (err) {
    if (!isDismissal(err)) throw err;
  }
  return true;
}

/**
 * Save a blob to the device as `filename`. Resolves once the save has been
 * handed off (or the user dismissed the share sheet); throws only when no path
 * is available or the platform's own path failed, so callers can surface a
 * failure indicator.
 */
export async function saveBlobAsFile(blob: Blob, filename: string): Promise<void> {
  if (await saveNative(blob, filename)) return;

  const type = blob.type || "image/png";
  const nav: FileShareNavigator | undefined =
    typeof navigator === "undefined" ? undefined : (navigator as unknown as FileShareNavigator);

  if (nav?.share && typeof File !== "undefined") {
    const file = new File([blob], filename, { type });
    // No `canShare` at all is not a no: try, and let the catch fall back.
    if (nav.canShare?.({ files: [file] }) ?? true) {
      try {
        await nav.share({ files: [file], title: filename });
        return;
      } catch (err) {
        // Dismissing the sheet is a decision — don't second-guess it with a
        // download. Any other error means share didn't work: fall through.
        if (isDismissal(err)) return;
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
