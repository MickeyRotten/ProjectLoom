import type { ComfySettings, GenerateImageOptions } from "../types";
import { ImageError } from "./imageError";
import { safeErrorText } from "./http";
import { backoffMs, isRetryableStatus, MAX_ATTEMPTS, sleep } from "./retry";
import { activeTemplate } from "./imageTemplates";

/**
 * ComfyUI as a second image backend (DESIGN.md → Image Generation → Backends).
 * A local ComfyUI instance draws the same portraits and location banners the
 * OpenRouter path does; `images.ts → generateImage` picks between them on
 * `Settings.imageBackend`, and everything downstream — the 1-bit pass, the
 * `src:` master, IndexedDB, the failure badge — only ever sees a Blob.
 *
 * The wire protocol, in four steps:
 *   1. POST /prompt   { prompt: <graph>, client_id } → { prompt_id }
 *   2. GET  /history/<prompt_id>  polled until the entry appears. It answers
 *      with a map KEYED BY prompt_id, not the bare entry; `{}` means pending.
 *   3. GET  /view?filename=…&subfolder=…&type=…  → the image bytes.
 *   4. POST /interrupt  on abort or timeout.
 *
 * The workflow is the player's, stored as raw ComfyUI API-format JSON (what
 * "Save (API Format)" exports) with `%placeholder%` tokens — the same contract
 * SillyTavern uses, so a workflow written for one works in the other. Kept pure
 * apart from the four functions that touch the network.
 */

/* ------------------------------- constants ------------------------------- */

export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

/** How often the history endpoint is asked whether the job is done. */
export const COMFY_POLL_MS = 500;

/**
 * How long a single generation may take before we give up and interrupt it.
 * SillyTavern polls forever; a phone that walked out of wifi range would then
 * sit on "rendering…" for the rest of the session. Generous, because a queued
 * job behind someone else's batch is a normal reason to wait.
 */
export const COMFY_TIMEOUT_MS = 300_000;

/**
 * The tokens substituted into the workflow. Deliberately SillyTavern's list,
 * spelling included — a player's existing workflow should just work.
 *
 * `scale` is CFG (there is no `%cfg%`), and `clip_skip` is negative, because
 * both are what `CLIPSetLastLayer` and `KSampler` actually take.
 */
export const COMFY_PLACEHOLDERS = [
  "prompt",
  "negative_prompt",
  "model",
  "vae",
  "sampler",
  "scheduler",
  "steps",
  "scale",
  "width",
  "height",
  "denoise",
  "clip_skip",
  "seed",
] as const;

export type ComfyPlaceholder = (typeof COMFY_PLACEHOLDERS)[number];

/**
 * The shipped txt2img graph — SillyTavern's default workflow, which is the
 * plainest possible checkpoint → CLIP → KSampler → VAE → save chain. Nothing
 * here is Loom-specific except the filename prefix; the style comes from the
 * prompt, and the 1-bit look from the client-side pass afterwards.
 *
 * `denoise` is hardcoded to 1: txt2img has no reason to vary it, and leaving
 * the token out of the default keeps one less number on the screen meaningful.
 */
export const DEFAULT_COMFY_WORKFLOW = `{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": "%seed%",
      "steps": "%steps%",
      "cfg": "%scale%",
      "sampler_name": "%sampler%",
      "scheduler": "%scheduler%",
      "denoise": 1,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "%model%" }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": { "width": "%width%", "height": "%height%", "batch_size": 1 }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "%prompt%", "clip": ["4", 1] }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "%negative_prompt%", "clip": ["4", 1] }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "Loom", "images": ["8", 0] }
  }
}`;

/**
 * ComfyUI defaults, spread into `defaultSettings()` the way `DEFAULT_DICE` is —
 * so "the default ComfyUI setup" has exactly one definition.
 *
 * The negative prompt is NOT here: it is wording rather than machine config, so
 * it rides the selected `ImagePromptTemplate` and changes with the dialect.
 */
export const DEFAULT_COMFY: ComfySettings = {
  imageBackend: "openrouter",
  comfyUrl: DEFAULT_COMFY_URL,
  comfyWorkflow: DEFAULT_COMFY_WORKFLOW,
  comfyModel: "",
  comfyVae: "",
  comfySampler: "euler",
  comfyScheduler: "normal",
  comfySteps: 25,
  comfyScale: 7,
  comfyWidth: 1024,
  comfyHeight: 1024,
  comfyDenoise: 1,
  comfyClipSkip: 1,
};

/* ----------------------------- normalization ----------------------------- */

/** Ceilings for the player-typed numbers — generous, but renderable. */
export const MAX_COMFY_STEPS = 150;
export const MAX_COMFY_SCALE = 30;
export const MAX_COMFY_SIDE = 4096;
export const MIN_COMFY_SIDE = 64;
export const MAX_COMFY_CLIP_SKIP = 12;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNum(v, min, max, fallback));
}

function text(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Fold whatever localStorage holds onto a usable ComfyUI config. Sanitized at
 * READ time, the way `normalizeDice` and `normalizeQuickActions` are, so the
 * settings screen can edit one field without having to rewrite the next — a
 * half-typed "10" in the width box must not be able to persist a 10px latent
 * that then fails every generation until someone notices.
 *
 * Sides snap to a multiple of 8 because that is what a latent is made of; the
 * workflow gets the exact number typed everywhere else.
 */
export function normalizeComfy(stored: Partial<ComfySettings> | undefined): ComfySettings {
  const s = { ...DEFAULT_COMFY, ...(stored ?? {}) };
  const side = (v: unknown, fallback: number) =>
    Math.round(clampInt(v, MIN_COMFY_SIDE, MAX_COMFY_SIDE, fallback) / 8) * 8;

  return {
    imageBackend: s.imageBackend === "comfyui" ? "comfyui" : "openrouter",
    comfyUrl: text(s.comfyUrl, DEFAULT_COMFY.comfyUrl),
    // A blank workflow is unusable and unrecoverable from the screen (the
    // editor would have nothing to show), so blank falls back to the shipped
    // graph. Anything non-blank is the player's, valid or not — `validateWorkflow`
    // reports it where they can see it rather than silently reverting an edit.
    comfyWorkflow: text(s.comfyWorkflow, "").trim()
      ? (s.comfyWorkflow as string)
      : DEFAULT_COMFY.comfyWorkflow,
    comfyModel: text(s.comfyModel, ""),
    comfyVae: text(s.comfyVae, ""),
    comfySampler: text(s.comfySampler, DEFAULT_COMFY.comfySampler),
    comfyScheduler: text(s.comfyScheduler, DEFAULT_COMFY.comfyScheduler),
    comfySteps: clampInt(s.comfySteps, 1, MAX_COMFY_STEPS, DEFAULT_COMFY.comfySteps),
    comfyScale: clampNum(s.comfyScale, 0, MAX_COMFY_SCALE, DEFAULT_COMFY.comfyScale),
    comfyWidth: side(s.comfyWidth, DEFAULT_COMFY.comfyWidth),
    comfyHeight: side(s.comfyHeight, DEFAULT_COMFY.comfyHeight),
    comfyDenoise: clampNum(s.comfyDenoise, 0, 1, DEFAULT_COMFY.comfyDenoise),
    comfyClipSkip: clampInt(s.comfyClipSkip, 1, MAX_COMFY_CLIP_SKIP, DEFAULT_COMFY.comfyClipSkip),
  };
}

/* -------------------------------- helpers -------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Trim a player-typed base URL to something joinable. Blank → the default. */
export function normalizeComfyUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_COMFY_URL;
}

/** `<base><path>` with exactly one slash between them. */
export function comfyUrl(base: string, path: string): string {
  return `${normalizeComfyUrl(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

/** One image in a finished job's outputs. */
export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/**
 * The /view URL for one output image. Every part is encoded — SillyTavern
 * interpolates them raw, which breaks the moment a filename_prefix or an output
 * subfolder contains a space.
 */
export function comfyViewUrl(base: string, image: ComfyImageRef): string {
  const q = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  return `${comfyUrl(base, "/view")}?${q.toString()}`;
}

/**
 * Substitute the placeholder tokens into the workflow TEXT.
 *
 * Two things make this work, and both are load-bearing:
 *   - the search token includes the surrounding quotes (`"%steps%"`, not
 *     `%steps%`), and
 *   - the replacement is `JSON.stringify(value)`, which supplies the quotes for
 *     a string and emits a bare number for a number.
 *
 * So `"steps": "%steps%"` becomes `"steps": 25` while `"text": "%prompt%"`
 * becomes a properly escaped JSON string — one mechanism, correct types, and a
 * prompt containing quotes or newlines can't break the document. It also means
 * a template must always WRAP the placeholder in quotes, even for numbers.
 */
export function substituteWorkflow(
  json: string,
  values: Partial<Record<ComfyPlaceholder, string | number>>,
): string {
  let out = json;
  for (const token of COMFY_PLACEHOLDERS) {
    const value = values[token];
    if (value === undefined) continue;
    out = out.replaceAll(`"%${token}%"`, JSON.stringify(value));
  }
  return out;
}

/** A fresh seed per generation — ⟳ means "try again", so it must differ. */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * Every placeholder value for one generation, read off the settings plus the
 * prompt, negative prompt and size this particular image wants.
 *
 * The negative prompt is passed in rather than read off `settings` because it
 * belongs to the selected `ImagePromptTemplate`, not to the machine config —
 * see `imageTemplates.ts`.
 */
export function workflowValues(
  settings: ComfySettings,
  prompt: string,
  negativePrompt: string,
  size: { width: number; height: number },
  seed = randomSeed(),
): Record<ComfyPlaceholder, string | number> {
  return {
    prompt,
    negative_prompt: negativePrompt,
    model: settings.comfyModel,
    vae: settings.comfyVae,
    sampler: settings.comfySampler,
    scheduler: settings.comfyScheduler,
    steps: settings.comfySteps,
    scale: settings.comfyScale,
    width: size.width,
    height: size.height,
    denoise: settings.comfyDenoise,
    // CLIPSetLastLayer counts backwards from the end, so the number a player
    // recognises as "clip skip 2" is -2 on the wire.
    clip_skip: -Math.abs(settings.comfyClipSkip),
    seed,
  };
}

/** Round to a multiple of 64 (never to zero) — what latent sizes want. */
function snap64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}

/**
 * The pixel size for one image. Banners take the configured size verbatim;
 * portraits pass `aspectRatio: "2:3"` (the same string the OpenRouter path
 * sends as `image_config.aspect_ratio`) and get that shape at the same pixel
 * AREA, so switching backends doesn't change how much work a portrait is.
 *
 * An unparseable ratio falls back to the configured size rather than guessing —
 * a wrong shape is recoverable, a zero-width latent is not.
 */
export function comfyDimensions(
  width: number,
  height: number,
  aspectRatio?: string,
): { width: number; height: number } {
  const base = { width: snap64(width), height: snap64(height) };
  if (!aspectRatio) return base;

  const [w, h] = aspectRatio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return base;

  const area = base.width * base.height;
  const scale = Math.sqrt(area / (w * h));
  return { width: snap64(w * scale), height: snap64(h * scale) };
}

/**
 * Why this workflow can't be used, or null when it can. Checked when the player
 * edits it AND before every generation, so a bad paste fails on the screen that
 * caused it rather than as a silent missing portrait forty turns later.
 *
 * Validation runs on the SUBSTITUTED text: the raw template is not valid JSON
 * for numeric fields (`"steps": "%steps%"` parses, but `"cfg": %scale%` — which
 * a player might write by hand — does not), and what has to parse is what we
 * actually send.
 */
export function validateWorkflow(json: string): string | null {
  if (!json.trim()) return "The workflow is empty.";
  if (!json.includes('"%prompt%"')) {
    return 'The workflow has no "%prompt%" placeholder, so the scene description would never reach it.';
  }

  const probe = substituteWorkflow(json, {
    prompt: "probe",
    negative_prompt: "probe",
    model: "probe",
    vae: "probe",
    sampler: "probe",
    scheduler: "probe",
    steps: 1,
    scale: 1,
    width: 64,
    height: 64,
    denoise: 1,
    clip_skip: -1,
    seed: 1,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(probe);
  } catch (err) {
    return `The workflow isn't valid JSON — ${err instanceof Error ? err.message : "parse failed"}.`;
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    return "The workflow must be an object of nodes — export it from ComfyUI with Save (API Format).";
  }
  if (!Object.keys(parsed).length) return "The workflow has no nodes.";
  return null;
}

/* --------------------------- response parsing ---------------------------- */

/**
 * The reason a finished job failed, formatted the way SillyTavern formats it —
 * node type, node id, exception. This is the only place ComfyUI says WHICH node
 * broke, which is the difference between "image failed" and "your checkpoint
 * name is wrong".
 */
export function comfyExecutionError(entry: unknown): string | null {
  if (!isRecord(entry) || !isRecord(entry.status)) return null;
  if (entry.status.status_str !== "error") return null;

  const messages = Array.isArray(entry.status.messages) ? entry.status.messages : [];
  const detail = messages
    .filter((m): m is [string, Record<string, unknown>] => Array.isArray(m) && m[0] === "execution_error")
    .map((m) => m[1])
    .filter(isRecord)
    .map((d) => `${d.node_type} [${d.node_id}] ${d.exception_type}: ${d.exception_message}`)
    .join("\n");

  return detail || "ComfyUI reported an error but said nothing about it.";
}

/** What one history poll told us. */
export interface ComfyPollResult {
  /** The job has left the queue — succeeded or failed. */
  done: boolean;
  /** Set when it failed. */
  error: string | null;
  /** Set when it succeeded and produced an image. */
  image: ComfyImageRef | null;
}

/**
 * Read one `/history/<id>` response. The endpoint answers with a map keyed by
 * prompt id even when asked for one prompt, so an absent key — the usual `{}` —
 * is simply "not finished yet".
 */
export function parseComfyEntry(history: unknown, promptId: string): ComfyPollResult {
  const pending: ComfyPollResult = { done: false, error: null, image: null };
  if (!isRecord(history)) return pending;

  const entry = history[promptId];
  if (!isRecord(entry)) return pending;

  const failed = comfyExecutionError(entry);
  if (failed) return { done: true, error: failed, image: null };

  const image = firstComfyImage(entry.outputs);
  if (image) return { done: true, error: null, image };

  // Present in history with no images: either still mid-write, or a workflow
  // whose terminal node saves nothing (a PreviewImage-only graph is the common
  // mistake). Only a completed status makes that second reading certain.
  const status = isRecord(entry.status) ? entry.status : null;
  if (status?.completed === true || status?.status_str === "success") {
    return {
      done: true,
      error:
        "ComfyUI finished but returned no image — the workflow needs a SaveImage node as its output.",
      image: null,
    };
  }
  return pending;
}

/** The first `images[]` entry across every output node, in node order. */
export function firstComfyImage(outputs: unknown): ComfyImageRef | null {
  if (!isRecord(outputs)) return null;
  for (const node of Object.values(outputs)) {
    if (!isRecord(node)) continue;
    const images = Array.isArray(node.images) ? node.images : [];
    for (const img of images) {
      if (!isRecord(img) || typeof img.filename !== "string") continue;
      return {
        filename: img.filename,
        subfolder: typeof img.subfolder === "string" ? img.subfolder : "",
        type: typeof img.type === "string" ? img.type : "output",
      };
    }
  }
  return null;
}

/** The reason a POST /prompt was rejected — the message plus any node errors. */
export function comfyPromptError(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const parts: string[] = [];
  if (isRecord(json.error) && typeof json.error.message === "string") {
    parts.push(json.error.message);
  }
  if (isRecord(json.node_errors)) {
    for (const [id, err] of Object.entries(json.node_errors)) {
      if (!isRecord(err)) continue;
      const type = typeof err.class_type === "string" ? err.class_type : "node";
      parts.push(`${type} [${id}]`);
    }
  }
  return parts.join(" — ") || null;
}

/**
 * The image type for a filename. ComfyUI sends `Content-Disposition` but not
 * `Access-Control-Expose-Headers`, so cross-origin we cannot read it — the
 * extension is all we have, and it's what SillyTavern uses too.
 */
export function comfyMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

/* ------------------------------- transport ------------------------------- */

/**
 * Base64 → Blob, for the native transport (below), which hands back a string
 * rather than a body. Deliberately not `images.ts → dataUrlToBlob`: importing
 * it would close the cycle this module exists outside of.
 */
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * ComfyUI is normally a plain-HTTP box on the LAN, which is three problems at
 * once inside a Capacitor WebView: the page is served from `https://localhost`
 * so `http://` is mixed content; Android blocks cleartext; and ComfyUI itself
 * returns a hard 403 to any request carrying `Sec-Fetch-Site: cross-site`
 * unless it was started with `--enable-cors-header`.
 *
 * Native HTTP answers all three — the request leaves from Java, not the
 * WebView, so none of those rules apply. On the web build there is no such
 * escape and `--enable-cors-header` is genuinely required; the error path says
 * so.
 *
 * Note the deliberate absence of a `Content-Type` header on POSTs: without one
 * the browser sends `text/plain`, which is a CORS *simple* request and skips
 * the preflight entirely. ComfyUI reads the body with `await request.json()`
 * and does not check the content type, so this costs nothing and saves a round
 * trip that `--enable-cors-header` would otherwise have to answer.
 */
async function nativeHttp() {
  const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
  return Capacitor.isNativePlatform() ? CapacitorHttp : null;
}

interface ComfyRequest {
  method?: "GET" | "POST";
  /** Already-serialized JSON body. */
  body?: string;
  signal?: AbortSignal;
}

/** One request returning parsed JSON, plus the status for the caller to judge. */
async function comfyJson(
  url: string,
  req: ComfyRequest = {},
): Promise<{ status: number; data: unknown; detail: string }> {
  const method = req.method ?? "GET";
  const http = await nativeHttp();

  if (http) {
    const res = await http.request({
      url,
      method,
      ...(req.body ? { data: JSON.parse(req.body) as unknown, headers: { "Content-Type": "application/json" } } : {}),
    });
    return { status: res.status, data: res.data as unknown, detail: describeNative(res.data) };
  }

  const res = await fetch(url, {
    method,
    ...(req.body ? { body: req.body } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  if (!res.ok) return { status: res.status, data: null, detail: await safeErrorText(res) };
  const data: unknown = await res.json().catch(() => null);
  return { status: res.status, data, detail: "" };
}

/** A failed native response carries its body in `data`, already parsed. */
function describeNative(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 200);
  if (isRecord(data) && isRecord(data.error) && typeof data.error.message === "string") {
    return data.error.message;
  }
  return "";
}

/** One request returning image bytes. */
async function comfyBlob(url: string, mime: string, signal?: AbortSignal): Promise<Blob> {
  const http = await nativeHttp();

  if (http) {
    const res = await http.request({ url, method: "GET", responseType: "blob" });
    if (res.status < 200 || res.status >= 300) {
      throw httpError("ComfyUI", res.status, describeNative(res.data));
    }
    if (typeof res.data !== "string") {
      throw new ImageError("ComfyUI returned an unreadable image.");
    }
    return base64ToBlob(res.data, mime);
  }

  const res = await fetch(url, { ...(signal ? { signal } : {}) });
  if (!res.ok) throw httpError("ComfyUI", res.status, await safeErrorText(res));
  return await res.blob();
}

/**
 * A status failure as an ImageError, with the one hint that matters. A 403 from
 * ComfyUI is almost never a permission problem — it is
 * `create_origin_only_middleware` rejecting a cross-origin request, i.e. the
 * server was started without `--enable-cors-header`. Left unexplained it reads
 * as "ComfyUI is broken", and there is nothing in the app to change that fixes it.
 */
function httpError(what: string, status: number, detail: string): ImageError {
  if (status === 403) {
    return new ImageError(
      "ComfyUI refused the connection (403). Start it with --enable-cors-header (and --listen 0.0.0.0 to reach it from another device).",
      { status },
    );
  }
  return new ImageError(`${what} ${status}${detail ? ` — ${detail}` : ""}`, {
    status,
    retryable: isRetryableStatus(status),
  });
}

/** A network-level failure (no response at all) is worth another attempt. */
function networkError(err: unknown): ImageError {
  if (err instanceof ImageError) return err;
  const why = err instanceof Error ? err.message : "request failed";
  return new ImageError(
    `Could not reach ComfyUI — ${why}. Check the URL under Model & Key.`,
    { retryable: true },
  );
}

/* ------------------------------ the requests ----------------------------- */

/** Reachability check for the Test button — and what version answered. */
export interface ComfyPing {
  version: string;
  device: string;
}

export async function pingComfy(url: string, signal?: AbortSignal): Promise<ComfyPing> {
  let res;
  try {
    res = await comfyJson(comfyUrl(url, "/system_stats"), { signal });
  } catch (err) {
    throw networkError(err);
  }
  if (res.status < 200 || res.status >= 300) {
    throw httpError("ComfyUI", res.status, res.detail);
  }

  const data = isRecord(res.data) ? res.data : {};
  const system = isRecord(data.system) ? data.system : {};
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const first = isRecord(devices[0]) ? devices[0] : {};
  return {
    version: typeof system.comfyui_version === "string" ? system.comfyui_version : "unknown",
    device: typeof first.name === "string" ? first.name : "",
  };
}

/** The option lists a player would otherwise have to type from memory. */
export interface ComfyOptions {
  models: string[];
  samplers: string[];
  schedulers: string[];
  vaes: string[];
}

/** Combo inputs are `[[...options], {...}]` — the list is the first element. */
function comboOptions(info: unknown, node: string, field: string): string[] {
  if (!isRecord(info)) return [];
  const nodeInfo = info[node];
  if (!isRecord(nodeInfo) || !isRecord(nodeInfo.input)) return [];
  const required = nodeInfo.input.required;
  if (!isRecord(required)) return [];
  const spec = required[field];
  if (!Array.isArray(spec) || !Array.isArray(spec[0])) return [];
  return spec[0].filter((v): v is string => typeof v === "string");
}

/**
 * Model / sampler / scheduler / VAE names, read off ComfyUI's own node schemas.
 * Every lookup is optional: a build without `UNETLoader` or `VAELoader` is
 * perfectly normal, and SillyTavern's unguarded version 500s on one.
 */
export async function fetchComfyOptions(url: string, signal?: AbortSignal): Promise<ComfyOptions> {
  const ask = async (node: string): Promise<unknown> => {
    try {
      const res = await comfyJson(comfyUrl(url, `/object_info/${node}`), { signal });
      return res.status >= 200 && res.status < 300 ? res.data : null;
    } catch {
      return null;
    }
  };

  const [sampler, ckpt, unet, vae] = await Promise.all([
    ask("KSampler"),
    ask("CheckpointLoaderSimple"),
    ask("UNETLoader"),
    ask("VAELoader"),
  ]);

  return {
    models: [
      ...comboOptions(ckpt, "CheckpointLoaderSimple", "ckpt_name"),
      ...comboOptions(unet, "UNETLoader", "unet_name"),
    ],
    samplers: comboOptions(sampler, "KSampler", "sampler_name"),
    schedulers: comboOptions(sampler, "KSampler", "scheduler"),
    vaes: comboOptions(vae, "VAELoader", "vae_name"),
  };
}

/** Best-effort cancel. Never throws — it runs while another error is unwinding. */
async function interrupt(base: string): Promise<void> {
  try {
    await comfyJson(comfyUrl(base, "/interrupt"), { method: "POST", body: "{}" });
  } catch {
    // The job will finish into history and be ignored. Nothing to report.
  }
}

/** Queue the graph, returning its prompt id. */
async function queuePrompt(base: string, graph: unknown, clientId: string): Promise<string> {
  let res;
  try {
    res = await comfyJson(comfyUrl(base, "/prompt"), {
      method: "POST",
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
  } catch (err) {
    throw networkError(err);
  }

  if (res.status < 200 || res.status >= 300) {
    const why = comfyPromptError(res.data) ?? res.detail;
    if (res.status === 400) {
      throw new ImageError(
        `ComfyUI rejected the workflow${why ? ` — ${why}` : ""}. Check the model name and the workflow under Model & Key.`,
        { status: 400 },
      );
    }
    throw httpError("ComfyUI", res.status, why);
  }

  const data = isRecord(res.data) ? res.data : {};
  if (typeof data.prompt_id !== "string") {
    throw new ImageError("ComfyUI accepted the job but returned no prompt id.", {
      retryable: true,
    });
  }
  return data.prompt_id;
}

/**
 * Poll until the job leaves the queue. A single failed poll is survivable —
 * wifi blinks, and the job is still running — so only the deadline ends the
 * wait. Aborting interrupts the job rather than leaving a GPU busy on an image
 * nobody will collect.
 */
async function awaitResult(
  base: string,
  promptId: string,
  signal?: AbortSignal,
): Promise<ComfyImageRef> {
  const deadline = Date.now() + COMFY_TIMEOUT_MS;

  for (;;) {
    if (signal?.aborted) {
      void interrupt(base);
      throw new DOMException("Aborted", "AbortError");
    }

    let poll: ComfyPollResult = { done: false, error: null, image: null };
    try {
      const res = await comfyJson(comfyUrl(base, `/history/${promptId}`), { signal });
      if (res.status === 403) throw httpError("ComfyUI", 403, "");
      if (res.status >= 200 && res.status < 300) poll = parseComfyEntry(res.data, promptId);
    } catch (err) {
      if (err instanceof ImageError && err.status === 403) throw err;
      if (signal?.aborted) throw err;
      // Anything else: treat as a blink and try again until the deadline.
    }

    if (poll.error) throw new ImageError(poll.error);
    if (poll.image) return poll.image;

    if (Date.now() >= deadline) {
      void interrupt(base);
      throw new ImageError(
        `ComfyUI did not finish within ${Math.round(COMFY_TIMEOUT_MS / 1000)}s. It may still be queued — check the ComfyUI window.`,
      );
    }
    await sleep(COMFY_POLL_MS, signal);
  }
}

/** A client id per generation. Only ComfyUI ever reads it. */
function clientId(): string {
  return `loom-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Generate one image through ComfyUI. Same contract as the OpenRouter path:
 * returns raw pixels, throws `ImageError`, and every failure is non-fatal to
 * the turn.
 *
 * Retries wrap the WHOLE flow (queue → poll → fetch) rather than one response,
 * because this backend fails at three separate points; `ImageError.retryable`
 * is what decides, so a rejected workflow surfaces immediately while an
 * unreachable host is tried again.
 *
 * `opts.images` — portrait style references, and the edit source — are not
 * used: they have no place in a txt2img graph, and ✎ is disabled for this
 * backend precisely because there is no generic way to feed an image into a
 * workflow the player wrote.
 */
export async function generateComfyImage(opts: GenerateImageOptions): Promise<Blob> {
  const { settings, prompt, aspectRatio, signal } = opts;
  const base = normalizeComfyUrl(settings.comfyUrl);

  const invalid = validateWorkflow(settings.comfyWorkflow);
  if (invalid) throw new ImageError(`ComfyUI workflow: ${invalid}`);

  const size = comfyDimensions(settings.comfyWidth, settings.comfyHeight, aspectRatio);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Re-substituted per attempt so a retry draws a fresh seed — a repeat of
      // the identical image would be a pointless second minute of GPU time.
      const workflow = substituteWorkflow(
        settings.comfyWorkflow,
        workflowValues(settings, prompt, activeTemplate(settings).negativePrompt, size),
      );
      const graph: unknown = JSON.parse(workflow);

      const id = await queuePrompt(base, graph, clientId());
      const image = await awaitResult(base, id, signal);
      return await comfyBlob(comfyViewUrl(base, image), comfyMime(image.filename), signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      const retryable = err instanceof ImageError ? err.retryable : err instanceof TypeError;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(backoffMs(attempt), signal);
    }
  }
  throw lastErr;
}
