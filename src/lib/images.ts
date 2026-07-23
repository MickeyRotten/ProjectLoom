import type { Character, Settings } from "../types";

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
 * Banner prompt: the (editable) 1-bit style instructions, the location name,
 * and a short narration excerpt for scene flavour.
 */
export function buildBannerPrompt(
  location: string,
  excerpt: string,
  instructions: string,
): string {
  const parts = [instructions.trim(), `Location: ${location.trim()}.`];
  const scene = excerpt.trim();
  if (scene) parts.push(`Scene: ${scene}`);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Portrait prompt: the (editable) 1-bit style instructions plus the member's
 * name / species / description. When the character opts into a custom prompt,
 * that text replaces the auto-built identity/appearance lines (the style
 * instructions still lead, so 1-bit output stays consistent).
 */
export function buildPortraitPrompt(
  member: Pick<Character, "name" | "species" | "description"> &
    Partial<Pick<Character, "useCustomPortraitPrompt" | "customPortraitPrompt">>,
  instructions: string,
): string {
  const parts = [instructions.trim()];
  if (member.useCustomPortraitPrompt && member.customPortraitPrompt?.trim()) {
    parts.push(member.customPortraitPrompt.trim());
    return parts.filter(Boolean).join("\n\n");
  }
  const who = [
    member.name.trim() && `Name: ${member.name.trim()}.`,
    member.species.trim() && `Species: ${member.species.trim()}.`,
  ]
    .filter(Boolean)
    .join(" ");
  if (who) parts.push(who);
  const appearance = member.description.trim();
  if (appearance) parts.push(`Appearance: ${appearance}`);
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

export interface GenerateImageOptions {
  settings: Settings;
  prompt: string;
  /** Source image as a data URL — when set, the request is an edit (image + text in). */
  image?: string;
  signal?: AbortSignal;
}

/**
 * Generate one image via OpenRouter and return it as a Blob. Non-streamed:
 * image models return the whole payload at once. Throws ImageError on a missing
 * key, a non-OK response, or a response with no image — callers treat any
 * failure as non-fatal (a failed image never blocks the turn).
 */
export async function generateImage(opts: GenerateImageOptions): Promise<Blob> {
  const { settings, prompt, image, signal } = opts;

  if (!settings.openRouterKey.trim()) {
    throw new ImageError("No OpenRouter API key set. Add one in Settings.");
  }

  const content = image
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } },
      ]
    : prompt;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openRouterKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/MickeyRotten/ProjectLoom",
      "X-Title": "Project Loom",
    },
    body: JSON.stringify({
      model: settings.imageModelId,
      modalities: ["image", "text"],
      messages: [{ role: "user", content }],
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new ImageError(
      `OpenRouter ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const json: unknown = await res.json();
  const dataUrl = extractImageDataUrl(json);
  if (!dataUrl) throw new ImageError("No image returned by the model.");
  return dataUrlToBlob(dataUrl);
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
