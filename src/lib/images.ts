import type { Character, DitherMode, RefImage, Settings } from "../types";
import { quantizeToOneBit } from "./onebit";
import { backoffMs, isRetryableStatus, MAX_ATTEMPTS, sleep } from "./retry";

/**
 * Image generation over OpenRouter (DESIGN.md → Image Generation). Two kinds,
 * both triggered deterministically by the client (never model-driven):
 *   - Location banner — keyed `banner:<location>`, generated on a scene change
 *     to an uncached location.
 *   - Party portrait — keyed `portrait:<memberId>`, generated when a member
 *     has no cached portrait.
 *
 * Access shape (verified against OpenRouter docs at build time): a normal
 * chat-completions POST with `modalities: ["image","text"]`; the generated
 * image comes back as a base64 data URL under
 * `choices[0].message.images[].image_url.url`. Kept mostly pure (key + prompt
 * builders, response extraction, data-URL→Blob) so it's testable; only
 * `generateImage` touches the network.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class ImageError extends Error {}

/* ------------------------------ cache keys ------------------------------ */

/** Blob-store key for a location banner. Case/whitespace-insensitive. */
export function bannerKey(location: string): string {
  return `banner:${location.trim().toLowerCase()}`;
}

/** Blob-store key for a member portrait. */
export function portraitKey(memberId: string): string {
  return `portrait:${memberId}`;
}

/**
 * Blob-store key for the MASTER copy behind a cached image — the pixels before
 * the downscale + 1-bit pass (a raw generation, or the file the player
 * uploaded). The displayed blob is deliberately tiny, which makes it a terrible
 * thing to hand back to an image model: an edit round-trip fed a 192px 1-bit
 * thumbnail comes back as mush, or as a text-only reply that fails the whole
 * edit. Every write path stores its master here so edits start from real pixels.
 */
export function sourceKey(key: string): string {
  return `src:${key}`;
}

/* ------------------------------- cooldown ------------------------------- */

/**
 * Upper bound on the banner cooldown (Advanced). Anything past a couple of
 * dozen turns is indistinguishable from "off" in practice; the cap only exists
 * so a mistyped number can't silently kill banners for the rest of the save.
 */
export const MAX_BANNER_COOLDOWN = 99;

/** Clamp a player-typed cooldown to a whole number of turns in range. */
export function clampBannerCooldown(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_BANNER_COOLDOWN, Math.max(0, Math.floor(value)));
}

/**
 * Turns still to wait before another location banner may be generated
 * automatically — 0 when generation is allowed right now.
 *
 * A cooldown of N means the N turns *after* the generating turn are skipped:
 * generated on turn T, turns T+1…T+N draw nothing new, T+N+1 draws again. The
 * gate is on GENERATION only — a location whose banner is already cached still
 * shows it instantly, and ⟳ ignores the cooldown entirely.
 *
 * `turnNumber` below `lastBannerTurn` (an undo walked the story back past the
 * generating turn) counts as no turns elapsed, so the wait holds rather than
 * evaporating.
 */
export function bannerCooldownLeft(
  cooldown: number,
  lastBannerTurn: number | undefined,
  turnNumber: number,
): number {
  const turns = clampBannerCooldown(cooldown);
  if (turns === 0 || lastBannerTurn === undefined || !Number.isFinite(lastBannerTurn)) return 0;
  const elapsed = Math.max(0, turnNumber - lastBannerTurn);
  return Math.max(0, turns + 1 - elapsed);
}

/** True while automatic banner generation is suppressed. */
export function bannerOnCooldown(
  cooldown: number,
  lastBannerTurn: number | undefined,
  turnNumber: number,
): boolean {
  return bannerCooldownLeft(cooldown, lastBannerTurn, turnNumber) > 0;
}

/* ---------------------------- prompt builders --------------------------- */

/**
 * Banner prompt: follows the Subject → Action → Location/context → Composition
 * → Style formula. The location name (Subject) and narration excerpt
 * (Location/context) lead, since they're per-scene; the (editable)
 * Action/Composition/Style instructions trail, so the 1-bit look stays fixed
 * last regardless of what the scene contains.
 */
export function buildBannerPrompt(
  location: string,
  excerpt: string,
  instructions: string,
): string {
  const parts = [`Location: ${location.trim()}.`];
  const scene = excerpt.trim();
  if (scene) parts.push(`Scene: ${scene}`);
  parts.push(instructions.trim());
  return parts.filter(Boolean).join("\n\n");
}

/** The Action/Location-context/Composition/Style clauses, editable per-game in Advanced. */
export interface PortraitInstructions {
  action: string;
  context: string;
  composition: string;
  style: string;
}

/**
 * The trailing clauses as unlabeled narrative paragraphs, in the
 * Action → Context → Composition → Style order. The defaults are full
 * sentences, so no `Action:`-style labels — the assembled prompt must read as
 * one coherent visual description.
 */
function formatPortraitInstructions(instructions: PortraitInstructions): string[] {
  return [
    instructions.action.trim(),
    instructions.context.trim(),
    instructions.composition.trim(),
    instructions.style.trim(),
  ].filter(Boolean);
}

/**
 * Portrait prompt: follows the Subject → Action → Location/context →
 * Composition → Style formula. The member's name/species/sex/description
 * (Subject) leads; the (editable) Action/Context/Composition/Style clauses
 * trail, so framing and style stay consistent across every party member
 * regardless of what the Subject describes. Subject is never a settings field
 * — it always comes from the character. When the character opts into a custom
 * prompt, that text replaces the auto-built Subject but the clauses still
 * trail it. `refInstruction` (set only when reference images ride along in the
 * request) lands as the final line.
 */
export function buildPortraitPrompt(
  member: Pick<Character, "name" | "species" | "description"> &
    Partial<Pick<Character, "sex" | "useCustomPortraitPrompt" | "customPortraitPrompt">>,
  instructions: PortraitInstructions,
  refInstruction?: string,
): string {
  const trailer = [...formatPortraitInstructions(instructions), refInstruction?.trim() ?? ""];
  if (member.useCustomPortraitPrompt && member.customPortraitPrompt?.trim()) {
    return [member.customPortraitPrompt.trim(), ...trailer].filter(Boolean).join("\n\n");
  }
  const who = [
    member.name.trim() && `Name: ${member.name.trim()}.`,
    member.species.trim() && `Species: ${member.species.trim()}.`,
    member.sex?.trim() && `Sex: ${member.sex.trim()}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const parts: string[] = [];
  if (who) parts.push(who);
  const appearance = member.description.trim();
  if (appearance) parts.push(`Appearance: ${appearance}`);
  parts.push(...trailer);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Edit prompt: the user's instruction plus a fixed style-preservation line.
 * The source image rides along in the request, so the style anchor comes from
 * the image itself — the line just keeps the model from repainting everything.
 */
export function buildEditPrompt(instruction: string): string {
  return [
    `Edit the attached image: ${instruction.trim()}`,
    "Preserve the existing style and composition except where the edit requires changes.",
  ].join("\n\n");
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

/**
 * Image types an image model will actually accept as an input part. A phone
 * gallery hands out plenty of things that are NOT on this list — HEIC/HEIF from
 * iOS, AVIF, BMP, TIFF — and posting one back as an edit source is rejected
 * every single time, which reads as "this picture can never be edited".
 */
const MODEL_SAFE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** True when `blob` can ride along in a request as-is. */
export function isModelSafeImage(blob: Blob): boolean {
  return MODEL_SAFE_MIME.has(blob.type.toLowerCase());
}

/** Encode a Blob as a base64 data URL (for sending a source image to edit). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ImageError("Could not read image blob."));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------ the request ----------------------------- */

/**
 * The key image requests bill against: the dedicated image key when set,
 * otherwise the main OpenRouter key. Trimmed; "" when neither is set.
 */
export function imageRequestKey(settings: Settings): string {
  return settings.imageKey?.trim() || settings.openRouterKey.trim();
}

export interface GenerateImageOptions {
  settings: Settings;
  prompt: string;
  /**
   * Input images as data URLs — style references and/or an edit source. Sent
   * as `image_url` parts *before* the text part.
   */
  images?: string[];
  /** e.g. "2:3" — forwarded as `image_config.aspect_ratio` when set. */
  aspectRatio?: string;
  signal?: AbortSignal;
}

/** True when an OpenRouter error looks like the request body was too big. */
function isPayloadError(status: number, detail: string): boolean {
  return status === 413 || /too large|payload|exceed/i.test(detail);
}

/**
 * Generate one image via OpenRouter and return it as a Blob. Non-streamed:
 * image models return the whole payload at once. Transient statuses retry with
 * backoff (same policy as the narration stream, lib/retry.ts); a 200 with no
 * image in it — the model sometimes answers text-only — is a soft failure worth
 * exactly one retry. Throws ImageError otherwise; callers treat any failure as
 * non-fatal (a failed image never blocks the turn).
 */
export async function generateImage(opts: GenerateImageOptions): Promise<Blob> {
  const { settings, prompt, images, aspectRatio, signal } = opts;

  const key = imageRequestKey(settings);
  if (!key) {
    throw new ImageError("No OpenRouter API key set. Add one in Model & Key.");
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
          "Image request too large — remove a reference image or use smaller ones (Advanced → Portrait Style).",
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

/* --------------------------- 1-bit post-process -------------------------- */

/**
 * Stored pixel widths. Small on purpose: the blobs stay tiny in IndexedDB and
 * the display upscale is nearest-neighbor via the existing CSS
 * `image-rendering: pixelated` on every `<img>`.
 */
export const PORTRAIT_PIXEL_WIDTH = 192;
export const BANNER_PIXEL_WIDTH = 256;

/**
 * Display width an upload keeps when 1-bit shading is OFF. With no quantization
 * there is no pixel grid for the art to land on, so the stored-width constants
 * above are just destruction — the image still has to be bounded (IndexedDB),
 * but at a size worth looking at.
 */
export const UPLOAD_PLAIN_WIDTH = 1024;

/** Longest side a master copy is scaled down to before it's stored. */
export const SOURCE_MAX_SIDE = 1024;

/** Width a saved-to-device image is upscaled to reach (see `toExportBlob`). */
export const EXPORT_MIN_WIDTH = 1024;

/**
 * Downscale + quantize a generated image to true 1-bit (the pure math lives in
 * onebit.ts). `mode === "off"` keeps the raw model output untouched.
 */
export async function toOneBitBlob(
  blob: Blob,
  targetWidth: number,
  mode: DitherMode,
): Promise<Blob> {
  if (mode === "off") return blob;
  return rescaleAndQuantize(blob, targetWidth, mode);
}

/**
 * Prepare a user-supplied image (custom portrait upload) for the blob store:
 * always downscaled — an untouched camera photo would be megabytes in
 * IndexedDB — and quantized to 1-bit unless shading is "off", so an upload
 * lands in the same visual system as a generated image. With shading off it
 * keeps a real display width instead of the 1-bit pixel width: there is no
 * pixel grid to snap to, so crushing it that far only loses the photo.
 *
 * Strict, unlike the generated-image path: a file the browser cannot decode
 * (HEIC straight off an iPhone, a renamed non-image) throws instead of being
 * stored verbatim. Storing it "succeeds" and then shows a broken portrait that
 * no later edit can ever repair, so the upload has to fail loudly here.
 */
export async function prepareUploadedImage(
  blob: Blob,
  targetWidth: number,
  mode: DitherMode,
): Promise<Blob> {
  return rescaleAndQuantize(blob, uploadStoredWidth(targetWidth, mode), mode, true);
}

/** The width `prepareUploadedImage` stores an upload at, per shading mode. */
export function uploadStoredWidth(targetWidth: number, mode: DitherMode): number {
  return mode === "off" ? Math.max(targetWidth, UPLOAD_PLAIN_WIDTH) : targetWidth;
}

/**
 * The master copy kept for later edits: the same pixels, bounded to
 * SOURCE_MAX_SIDE and re-encoded as JPEG so it stays a couple hundred KB in
 * IndexedDB and a sane payload to POST back as an edit source. An image that is
 * already model-safe (PNG/JPEG/WebP) and inside the box is stored as-is.
 *
 * Returns **null** when no usable master can be made — an undecodable upload,
 * or a decodable one in a format no image model accepts (HEIC, AVIF, BMP…) that
 * we also can't re-encode. A master is an optimization, never a hard
 * requirement, and no master at all is strictly better than one that makes
 * every future edit fail on the wire.
 */
export async function toSourceBlob(blob: Blob, maxSide = SOURCE_MAX_SIDE): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSide && isModelSafeImage(blob)) {
      bitmap.close();
      return blob;
    }
    // Never enlarge — an in-the-box image is here only to be re-encoded.
    const scale = Math.min(1, maxSide / longest);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return isModelSafeImage(blob) ? blob : null;
    ctx.imageSmoothingEnabled = true;
    // JPEG has no alpha — flatten onto white so transparent art keeps its paper.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    return out ?? (isModelSafeImage(blob) ? blob : null);
  } catch {
    return isModelSafeImage(blob) ? blob : null;
  }
}

/**
 * Integer upscale factor that takes `width` to at least `minWidth`. Integer on
 * purpose: a whole-number nearest-neighbor blow-up maps every stored pixel to
 * an exact square, so the exported file is the on-screen art enlarged, not a
 * resampled approximation of it.
 */
export function exportScale(width: number, minWidth = EXPORT_MIN_WIDTH): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.ceil(minWidth / width));
}

/**
 * Blow a stored image up for saving to the device. The cached blob is the
 * display copy — 192–256px wide for 1-bit art — which lands in a gallery as a
 * postage stamp; the app only gets away with it because every `<img>` renders
 * `image-rendering: pixelated`. A file has no such CSS, so the export bakes the
 * same nearest-neighbor upscale into the pixels. Already-large images (shading
 * off) pass through untouched, as does anything we can't decode.
 */
export async function toExportBlob(blob: Blob, minWidth = EXPORT_MIN_WIDTH): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = exportScale(bitmap.width, minWidth);
    if (scale === 1) {
      bitmap.close();
      return blob;
    }
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    // Nearest-neighbor: smoothing here would blur the 1-bit pixels into grey.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return out ?? blob;
  } catch {
    return blob;
  }
}

/**
 * Shared resize (+ optional quantize) pass. Downscaling steps by halves before
 * the final resize — one big jump would alias, since canvas resampling only
 * looks at a few source pixels. Any failure (no canvas, undecodable blob)
 * returns the original blob: the image pipeline is fire-and-forget and must
 * never get worse than "unprocessed".
 *
 * `strict` flips that for user-supplied files, where "unprocessed" means
 * storing something the browser could not even decode — see
 * `prepareUploadedImage`.
 */
async function rescaleAndQuantize(
  blob: Blob,
  requestedWidth: number,
  mode: DitherMode,
  strict = false,
): Promise<Blob> {
  const bail = (why: string): Blob => {
    if (strict) throw new ImageError(why);
    return blob;
  };
  try {
    const bitmap = await createImageBitmap(blob);
    // Never enlarge: a small source stretched to the stored width is fake
    // detail, and the display upscale already happens in CSS.
    const targetWidth = Math.max(1, Math.min(requestedWidth, bitmap.width));
    const targetHeight = Math.max(1, Math.round((targetWidth * bitmap.height) / bitmap.width));

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
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    if (mode !== "off") {
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      quantizeToOneBit(imageData.data, targetWidth, targetHeight, mode);
      ctx.putImageData(imageData, 0, 0);
    }
    bitmap.close();

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
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

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json: unknown = JSON.parse(text);
      if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
        return json.error.message;
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return "";
  }
}
