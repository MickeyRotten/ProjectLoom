import type {
  Character,
  GameState,
  GenerateImageOptions,
  ImagePromptTemplate,
  PromptFormat,
  RefImage,
  Settings,
} from "../types";
import { backoffMs, isRetryableStatus, MAX_ATTEMPTS, sleep } from "./retry";
import { generateComfyImage } from "./comfyui";
import { ImageError } from "./imageError";
import { safeErrorText } from "./http";

/**
 * Image generation (DESIGN.md → Image Generation). One kind, triggered
 * deterministically by the client (never model-driven): the party portrait,
 * keyed `portrait:<memberId>`, generated when a member has no cached portrait.
 *
 * Two backends, one seam: `generateImage` dispatches on `Settings.imageBackend`
 * and returns a Blob either way, so the store pass, the cache and the failure
 * badge below never learn which one drew it. The OpenRouter path is here;
 * ComfyUI lives in `comfyui.ts`.
 *
 * **One picture per key.** The app used to keep two — a 192px 1-bit display
 * copy under the key, and the pixels it was crushed from under `src:<key>` —
 * because the displayed art was quantized on-device and an edit round-trip
 * needed something better than a thumbnail to send back. Both halves of that are
 * gone: nothing quantizes and nothing edits, so what the model drew (bounded to
 * `MAX_IMAGE_SIDE`) is simply what is stored and what is shown.
 *
 * OpenRouter access shape (verified against their docs at build time): a normal
 * chat-completions POST with `modalities: ["image","text"]`; the generated
 * image comes back as a base64 data URL under
 * `choices[0].message.images[].image_url.url`. Kept mostly pure (key + prompt
 * builders, response extraction, data-URL→Blob) so it's testable; only
 * `generateImage` touches the network.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export { ImageError } from "./imageError";
export type { GenerateImageOptions } from "../types";

/* ------------------------------ cache keys ------------------------------ */

export const PORTRAIT_PREFIX = "portrait:";
export const SLOT_IMAGE_PREFIX = "slot:";

/**
 * Where the master copy of an image USED to live, back when the key itself held
 * a downscaled 1-bit copy of it. Read-only and migration-only now: on the first
 * launch after the display copy was retired, `db.ts → promoteLegacyMasters`
 * moves every `src:<key>` blob onto `<key>` and drops the prefix, which is what
 * keeps the masters (the good pixels) and throws away the thumbnails.
 *
 * Nothing writes this prefix any more. It stays named here rather than spelled
 * as a literal in the migration, because the keyspace is this module's to own.
 */
export const LEGACY_MASTER_PREFIX = "src:";

/** Blob-store key for a member portrait. */
export function portraitKey(memberId: string): string {
  return `${PORTRAIT_PREFIX}${memberId}`;
}

/**
 * Blob-store key for one save slot's FROZEN copy of an image.
 *
 * The live keyspace holds one picture per character (`portrait:<id>`), so every
 * regenerate, upload and removal rewrote the art of every snapshot ever taken of
 * that character: restore an old save and you got the old story with today's
 * faces. A snapshot copies the art it was taken with under its own id, and the
 * same character in two snapshots holds two different pictures.
 *
 * Copies rather than versioned live keys, deliberately: everything that renders
 * a portrait — the top bar, the party strip, the member sheet — keeps reading
 * the bare `portrait:<id>` it always did, and a restore is a copy back.
 */
export function slotScopedKey(slotId: string, key: string): string {
  return `${SLOT_IMAGE_PREFIX}${slotId}:${key}`;
}

/** One image in both keyspaces: `live` is where it renders, `slot` the freeze. */
export interface ImagePair {
  live: string;
  slot: string;
}

/**
 * Every blob a snapshot of `characters` freezes, as live ⇄ slot key pairs.
 *
 * Pure, and read in BOTH directions — a snapshot copies `live`→`slot`, a restore
 * copies `slot`→`live` — so the two halves cannot drift into disagreeing about
 * which art belongs to a slot. A key with nothing behind it is simply not
 * copied; the caller does the store lookups.
 *
 * One pair per character, since a character is one picture: the master ⇄ display
 * pairing this used to carry went with the display copy itself.
 */
export function slotArtPairs(
  slotId: string,
  characters: readonly Pick<Character, "id">[] | undefined,
): ImagePair[] {
  const out: ImagePair[] = [];
  for (const c of characters ?? []) {
    if (!c?.id) continue;
    const live = portraitKey(c.id);
    out.push({ live, slot: slotScopedKey(slotId, live) });
  }
  return out;
}

/**
 * Prefix covering every blob one slot froze — what dropping a slot sweeps. The
 * retired master prefix rides along because a device upgrading from a build that
 * wrote them may still hold `src:slot:<id>:…` blobs that no live key names.
 */
export function slotArtPrefixes(slotId: string): string[] {
  return [
    slotScopedKey(slotId, ""),
    `${LEGACY_MASTER_PREFIX}${slotScopedKey(slotId, "")}`,
  ];
}

/**
 * The art one saved game needs to look right when it is restored — the cast's
 * frozen portraits. This is what a cloud save carries (`sync.ts → planImages`),
 * and it is a small, bounded set on purpose: the blob store also holds the
 * portraits of everyone a long game has ever met, and nobody restores to those.
 *
 * The portraits are the SLOT'S copies, not the live ones. That is what makes the
 * freeze survive the trip: a pulled slot lands under its own keys, so the art of
 * a save taken on another device can no longer overwrite the portraits of the
 * game being played on this one.
 */
export function slotImageKeys(slot: { id: string; game: GameState }): string[] {
  // Read defensively: this also runs over slot documents pulled from the cloud,
  // which may have been written by a build from before the cast lived in the
  // game — a shape the type says cannot happen and the wire says can.
  const keys = (slot.game?.characters ?? [])
    .filter((c) => c?.id)
    .map((c) => slotScopedKey(slot.id, portraitKey(c.id)));
  return [...new Set(keys)];
}

/* ----------------------------- generation gate --------------------------- */

/**
 * Whether a request may be sent to the image model at all
 * (`Settings.imagesEnabled`, Images).
 *
 * Written as `!== false` rather than a bare read: a save from before the switch
 * existed carries no field, and the only sane reading of "absent" is the
 * behaviour that save was played with — images on. `loadSettings` merges the
 * default in anyway; this makes a settings object built by hand (or by a test)
 * behave the same way.
 *
 * The gate is on GENERATION only. Cached art still displays, uploads still land,
 * and nothing stored is deleted — switching back on picks up exactly where the
 * player left off.
 */
export function imagesAllowed(settings: Pick<Settings, "imagesEnabled">): boolean {
  return settings.imagesEnabled !== false;
}

/* ---------------------------- prompt builders --------------------------- */

/**
 * Join a prompt's parts the way the target model reads them — the structural
 * half of an `ImagePromptTemplate`, and the half no rewording could cover.
 *
 * `prose` keeps the paragraphs the Nano Banana formula wants. `tags` strips each
 * part's trailing sentence punctuation and comma-joins, so a template whose
 * fields are tag lists produces one tag list rather than a stack of paragraphs
 * that happen to contain commas.
 */
export function joinPromptParts(parts: string[], format: PromptFormat): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (format !== "tags") return clean.join("\n\n");
  return clean.map((p) => p.replace(/[\s.,;]+$/, "")).filter(Boolean).join(", ");
}

/**
 * Portrait prompt: follows the Subject → Action → Location/context →
 * Composition → Style formula. The member's name/species/sex/description
 * (Subject) leads; the template's Action/Context/Composition/Style clauses
 * trail, so framing and style stay consistent across every party member
 * regardless of what the Subject describes. Subject is never a settings field
 * — it always comes from the character. When the character opts into a custom
 * prompt, that text replaces the auto-built Subject but the clauses still
 * trail it. The template's reference line lands last, and only when reference
 * images ride along in the request (`withRefs`).
 *
 * In `tags` format the labels go, and so does the NAME: a diffusion model's text
 * encoder has no idea who Bran is, and the tokens it spends failing to find out
 * come out of a 77-token budget the appearance needs.
 */
export function buildPortraitPrompt(
  member: Pick<Character, "name" | "species" | "description"> &
    Partial<Pick<Character, "sex" | "useCustomPortraitPrompt" | "customPortraitPrompt">>,
  template: ImagePromptTemplate,
  withRefs = false,
): string {
  const trailer = [
    template.portraitAction,
    template.portraitContext,
    template.portraitComposition,
    template.portraitStyle,
    withRefs ? template.portraitRefInstruction : "",
  ];
  if (member.useCustomPortraitPrompt && member.customPortraitPrompt?.trim()) {
    return joinPromptParts([member.customPortraitPrompt, ...trailer], template.format);
  }

  const subject: string[] = [];
  if (template.format === "tags") {
    subject.push(member.species, member.sex ?? "", member.description);
  } else {
    const who = [
      member.name.trim() && `Name: ${member.name.trim()}.`,
      member.species.trim() && `Species: ${member.species.trim()}.`,
      member.sex?.trim() && `Sex: ${member.sex.trim()}.`,
    ]
      .filter(Boolean)
      .join(" ");
    if (who) subject.push(who);
    if (member.description.trim()) subject.push(`Appearance: ${member.description.trim()}`);
  }
  return joinPromptParts([...subject, ...trailer], template.format);
}

/* --------------------------- response parsing --------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Pull the first base64 image data URL out of an OpenRouter chat-completions
 * response. Tolerant of the two shapes seen in the wild: an `images[]` array of
 * `{ image_url: { url } }` (also accepts a bare `{ url }`), or a data URL placed
 * directly in `message.content`. Returns null if none is present.
 */
export function extractImageDataUrl(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const choices = json.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;

  const images = message.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (!isRecord(img)) continue;
      const imageUrl = img.image_url;
      const nested = isRecord(imageUrl) ? imageUrl.url : undefined;
      const url = typeof nested === "string" ? nested : img.url;
      if (typeof url === "string" && url.startsWith("data:image")) return url;
    }
  }

  const content = message.content;
  if (typeof content === "string" && content.startsWith("data:image")) return content;

  return null;
}

/**
 * The assistant's TEXT reply, when there is one. A model that answers a
 * generation request in words instead of pixels is usually saying why —
 * "I can't create images of real people", a content-policy line, a request for
 * clarification. Throwing that away leaves the player with a bare "image
 * failed" and nothing to change, so failures quote it back.
 */
export function extractMessageText(json: unknown): string {
  if (!isRecord(json)) return "";
  const first = Array.isArray(json.choices) ? json.choices[0] : undefined;
  if (!isRecord(first) || !isRecord(first.message)) return "";
  const content = first.message.content;
  if (typeof content === "string") {
    return content.startsWith("data:image") ? "" : content.trim();
  }
  // Some providers answer with the parts array instead of a bare string.
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

/** Decode a `data:` URL (base64 or percent-encoded) into a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) {
    throw new ImageError("Malformed data URL.");
  }
  const head = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = head.split(";")[0] || "image/png";

  if (/;base64/i.test(head)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

/* ------------------------------ the request ----------------------------- */

/**
 * The key image requests bill against: the dedicated image key when set,
 * otherwise the main OpenRouter key. Trimmed; "" when neither is set.
 */
export function imageRequestKey(settings: Settings): string {
  return settings.imageKey?.trim() || settings.openRouterKey.trim();
}

/** True when an OpenRouter error looks like the request body was too big. */
function isPayloadError(status: number, detail: string): boolean {
  return status === 413 || /too large|payload|exceed/i.test(detail);
}

/**
 * Generate one image and return it as a Blob — the single seam every image in
 * the app comes through, whichever backend the player picked.
 */
export async function generateImage(opts: GenerateImageOptions): Promise<Blob> {
  if (opts.settings.imageBackend === "comfyui") return generateComfyImage(opts);
  return generateOpenRouterImage(opts);
}

/**
 * Generate one image via OpenRouter and return it as a Blob. Non-streamed:
 * image models return the whole payload at once. Transient statuses retry with
 * backoff (same policy as the narration stream, lib/retry.ts); a 200 with no
 * image in it — the model sometimes answers text-only — is a soft failure worth
 * exactly one retry. Throws ImageError otherwise; callers treat any failure as
 * non-fatal (a failed image never blocks the turn).
 */
export async function generateOpenRouterImage(opts: GenerateImageOptions): Promise<Blob> {
  const { settings, prompt, images, aspectRatio, signal } = opts;

  const key = imageRequestKey(settings);
  if (!key) {
    throw new ImageError("No OpenRouter API key set. Add one in Images → Model.");
  }

  const content = images?.length
    ? [
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        { type: "text", text: prompt },
      ]
    : prompt;

  const body = JSON.stringify({
    model: settings.imageModelId,
    // Both modalities must be present — image-only requests are rejected.
    modalities: ["image", "text"],
    messages: [{ role: "user", content }],
    // No image_size: Lite models output 1K only.
    ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
  });

  let softRetried = false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/MickeyRotten/ProjectLoom",
        "X-Title": "Project Loom",
      },
      body,
      signal,
    });

    if (!res.ok) {
      if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt), signal);
        continue;
      }
      const detail = await safeErrorText(res);
      if (images?.length && isPayloadError(res.status, detail)) {
        throw new ImageError(
          "Image request too large — remove a reference image or use smaller ones (Images → Prompt Templates).",
        );
      }
      throw new ImageError(
        `OpenRouter ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const json: unknown = await res.json();
    const dataUrl = extractImageDataUrl(json);
    if (!dataUrl) {
      if (!softRetried) {
        softRetried = true;
        continue;
      }
      const said = extractMessageText(json);
      throw new ImageError(
        said
          ? `The model answered with text instead of an image — ${said.slice(0, 160)}`
          : "No image returned by the model.",
      );
    }
    return dataUrlToBlob(dataUrl);
  }
}

/* ---------------------------- the stored image --------------------------- */

/**
 * Longest side a stored image is scaled down to.
 *
 * The one bound left. Portraits used to be stored twice — a 192px 1-bit display
 * copy, plus the pixels behind it — and the small copy was the one on screen,
 * which is why every `<img>` rendered `image-rendering: pixelated`. Now the
 * picture the model drew IS the picture, so the only thing left to decide is how
 * much of it IndexedDB has to hold: a phone camera's 12-megapixel JPEG is
 * megabytes per character, and nothing in the app ever displays a portrait
 * larger than a phone screen.
 */
export const MAX_IMAGE_SIDE = 1024;

/**
 * Prepare a picture for the blob store: decoded, bounded to `maxSide`, and
 * re-encoded as JPEG when it had to be resized. An image already inside the box
 * is stored exactly as it came — a generated PNG keeps its alpha, and a file the
 * player uploaded keeps its own bytes.
 *
 * Downscaling steps by halves before the final resize: one big jump aliases,
 * since canvas resampling only looks at a few source pixels.
 *
 * `strict` decides what a failure means. The generated path is lenient — the
 * image pipeline is fire-and-forget and "unprocessed" beats "no portrait" — but
 * an UPLOAD must fail loudly: storing a file the browser could not even decode
 * (HEIC straight off an iPhone, a renamed non-image) "succeeds" and then shows a
 * broken portrait forever, so it has to be refused at the door.
 */
export async function toStoredImage(
  blob: Blob,
  maxSide = MAX_IMAGE_SIDE,
  strict = false,
): Promise<Blob> {
  const bail = (why: string): Blob => {
    if (strict) throw new ImageError(why);
    return blob;
  };
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    // Never enlarge — the box is a ceiling, not a target.
    if (longest <= maxSide) {
      bitmap.close();
      return blob;
    }
    const scale = maxSide / longest;
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    let source: ImageBitmap | HTMLCanvasElement = bitmap;
    let w = bitmap.width;
    let h = bitmap.height;
    while (w / 2 >= targetWidth) {
      w = Math.round(w / 2);
      h = Math.round(h / 2);
      const half = document.createElement("canvas");
      half.width = w;
      half.height = h;
      const halfCtx = half.getContext("2d");
      if (!halfCtx) return bail("This device could not process the image.");
      halfCtx.imageSmoothingEnabled = true;
      halfCtx.drawImage(source, 0, 0, w, h);
      source = half;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return bail("This device could not process the image.");
    ctx.imageSmoothingEnabled = true;
    // JPEG has no alpha — flatten onto white so transparent art keeps its paper.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    return out ?? bail("This device could not encode the image.");
  } catch (err) {
    if (err instanceof ImageError) throw err;
    return bail("Could not read that image file — try a JPG, PNG, or WebP.");
  }
}

/* ---------------------------- reference images --------------------------- */

/** At most this many style reference images ride along with a portrait. */
export const MAX_REF_IMAGES = 3;

/** Longest side a stored reference is scaled down to on upload. */
export const REF_MAX_SIDE = 768;

/**
 * Prepare an uploaded file as a stored reference: scale to fit REF_MAX_SIDE
 * and re-encode as JPEG. References live base64-inline in Settings
 * (localStorage, ~5MB quota), so a raw camera photo must shrink before it's
 * stored — and a smaller request body is cheaper to send every generation too.
 */
export async function blobToRefImage(blob: Blob, maxSide = REF_MAX_SIDE): Promise<RefImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Could not read the reference image.");
  ctx.imageSmoothingEnabled = true;
  // JPEG has no alpha — flatten onto white so transparent art keeps its paper.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new ImageError("Could not encode the reference image.");
  return { mime: "image/jpeg", b64: dataUrl.slice(comma + 1) };
}

/** Rehydrate a stored reference into the data URL the API expects. */
export function refImageToDataUrl(ref: RefImage): string {
  return `data:${ref.mime};base64,${ref.b64}`;
}

