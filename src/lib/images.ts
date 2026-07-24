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
 * Composition → Style formula. The member's name/species/description
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
    Partial<Pick<Character, "useCustomPortraitPrompt" | "customPortraitPrompt">>,
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
      throw new ImageError("No image returned by the model.");
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
export const PORTRAIT_PIXEL_WIDTH = 128;
export const BANNER_PIXEL_WIDTH = 256;

/**
 * Downscale + quantize a generated image to true 1-bit (the pure math lives in
 * onebit.ts). Downscaling steps by halves before the final resize — one big
 * jump would alias, since canvas resampling only looks at a few source pixels.
 * Any failure (no canvas, undecodable blob) returns the original blob: the
 * image pipeline is fire-and-forget and must never get worse than "unprocessed".
 */
export async function toOneBitBlob(
  blob: Blob,
  targetWidth: number,
  mode: DitherMode,
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
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
      if (!halfCtx) return blob;
      halfCtx.imageSmoothingEnabled = true;
      halfCtx.drawImage(source, 0, 0, w, h);
      source = half;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    quantizeToOneBit(imageData.data, targetWidth, targetHeight, mode);
    ctx.putImageData(imageData, 0, 0);
    bitmap.close();

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return out ?? blob;
  } catch {
    return blob;
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
