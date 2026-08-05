import { PROMPT_FORMATS } from "../types";
import type { ImagePromptTemplate, PromptFormat, Settings } from "../types";

/**
 * Image prompt templates (DESIGN.md → Image Generation → Prompt Templates).
 *
 * Everything that decides HOW an image prompt is worded lives in one named,
 * switchable bundle: the four portrait clauses, the reference line, the
 * diffusion negative prompt, and the narrator's own appearance rule —
 * because `Character.description` becomes the portrait's Subject verbatim, so
 * the sentence that writes it is part of the image dialect, not of the
 * character system.
 *
 * The bundle exists because the two image backends want different LANGUAGES. A
 * chat image model (OpenRouter's Gemini path) is told what to draw in prose; an
 * SD-family checkpoint behind ComfyUI reads a comma-separated tag list, and
 * writing prose at it wastes most of a 77-token encoder window. That is a
 * difference in `format` as well as in wording — see `images.ts →
 * joinPromptParts` — so the format rides in the template rather than being
 * inferred from the backend: the player may well run a prose-friendly checkpoint
 * locally, and the two choices are theirs to combine.
 *
 * Deliberately NOT in here: `portraitRefImages` and every ComfyUI connection
 * field. Those are behaviour and machine config — a template should survive
 * changing checkpoints, and a checkpoint should survive changing dialects.
 *
 * Pure and dependency-light on purpose: this module imports types only, so
 * `comfyui.ts` can read the active template's negative prompt without the
 * settings ⟂ comfy cycle that would otherwise create.
 */

/** The two ids that ship. Stable, because they are also the "reset" anchors. */
export const PROSE_TEMPLATE_ID = "prose";
export const TAGS_TEMPLATE_ID = "tags";

/** The editable half of a template — everything but its identity. */
export type TemplateText = Omit<ImagePromptTemplate, "id" | "name" | "format">;

/* --------------------------- prose (chat models) -------------------------- */

/*
 * Written as full narrative sentences — Gemini image models respond to
 * descriptions, not keyword lists. Deliberate constraints:
 *
 * - "Pixel art" never appears, even as a negation: a model-drawn fake pixel
 *   grid reads as a compression artifact rather than as a style.
 * - Fine hatching/stippling is ruled out: it muddies to grey at the size a
 *   portrait is actually looked at, while bold shadow shapes hold their edge.
 * - The style clause carries no anatomy, body-type, armor, or gear language —
 *   subject specifics come only from the character's own description, so the
 *   same template fits knights, mages, children, and beasts.
 */

export const DEFAULT_PORTRAIT_ACTION = `The pose is perfectly neutral and still: arms relaxed at the sides, shoulders square to the camera, head level, mouth closed, eyes open, with a calm, expressionless face.`;

export const DEFAULT_PORTRAIT_CONTEXT = `The background is flat, pure white and completely empty.`;

export const DEFAULT_PORTRAIT_COMPOSITION = `A waist-up portrait, character centered and facing the viewer directly.`;

export const DEFAULT_PORTRAIT_STYLE = `Clean black-and-white ink illustration in the style of a 1990s Western comic book with heavy anime influence. Bold, thick, confidently tapering ink lines define a strong graphic silhouette. Shadows are large, solid black shapes with hard edges, creating dramatic chiaroscuro. The entire image uses strictly two tones, pure black and pure white, with all shading done through bold shadow shapes rather than gradients, grey tones, or fine hatching. Sharp, high-contrast finish with no anti-aliasing.`;

/**
 * Appended as the final prompt line only when reference images ride along.
 * Cost: references add roughly $0.0003 per generation against a ~$0.0017 base —
 * negligible, and the repeated reference content is a good candidate for
 * OpenRouter's prompt caching.
 */
export const DEFAULT_REFERENCE_INSTRUCTION = `Match only the art style, line weight, ink density, and framing of the reference images. Do not copy the characters' faces, body types, clothing, or equipment.`;

/**
 * What to keep OUT of the picture. Reaches the ComfyUI path only — a chat image
 * model is told in prose, a diffusion model needs its own list — but it is
 * dialect, not machine config, so it rides the template with the rest of the
 * wording rather than sitting beside the sampler.
 */
export const DEFAULT_NEGATIVE_PROMPT =
  "color, colour, photo, photorealistic, blurry, text, watermark, signature, jpeg artifacts";

/**
 * How the narrator writes a party member's "description" delta field. It flows
 * verbatim into the member's portrait prompt as the Subject, so it must stay
 * concrete and visual — the whole portrait consistency chain starts here.
 * Interpolated into the output protocol's party line (prompt.ts) and used as the
 * Appearance rule by `generateField.ts`, so "Appearance" means one thing
 * app-wide.
 */
export const DEFAULT_APPEARANCE_INSTRUCTIONS = `"description" is physical appearance ONLY — hair, eyes, build, clothing, notable features — used verbatim to generate the member's portrait, so keep it concrete and visual, never personality or backstory.`;

/* ------------------------- tags (diffusion models) ------------------------ */

/*
 * The SD-family dialect: short Danbooru-ish tags, most important first, no
 * sentences. Same three constraints as the prose set — no fake pixel art, no
 * fine hatching, no anatomy language in the style clause — expressed as tags.
 *
 * `monochrome, greyscale` is the booru pair for a black-and-white drawing;
 * neither alone is reliable. Quality boosters ("masterpiece", "best quality")
 * are deliberately absent: they are checkpoint-specific superstition, and a
 * player who wants them can add them to the style field they own.
 */

export const TAG_PORTRAIT_ACTION = `standing, arms at sides, closed mouth, expressionless, looking at viewer, neutral pose`;

export const TAG_PORTRAIT_CONTEXT = `simple background, white background, plain background`;

export const TAG_PORTRAIT_COMPOSITION = `solo, upper body, front view, centered, straight-on`;

export const TAG_PORTRAIT_STYLE = `monochrome, greyscale, lineart, bold outlines, thick lines, flat black shadows, cel shading, high contrast, two-tone, no gradients, comic book style, anime style`;

export const TAG_NEGATIVE_PROMPT =
  "worst quality, low quality, lowres, jpeg artifacts, blurry, color, colored, photo, photorealistic, text, watermark, signature, bad anatomy, bad hands, extra limbs, gradient, soft shading, halftone";

/**
 * The tag dialect's appearance rule. The one field in this set aimed at the TEXT
 * model rather than the image one, and the reason the appearance rule belongs in
 * the template at all: a portrait prompt cannot be tags if the Subject it is
 * built from is a paragraph of prose.
 *
 * The trade is visible to the player — this is also the text on the character
 * sheet — which is why it is a template they choose rather than something the
 * backend switch does behind their back.
 */
export const TAG_APPEARANCE_INSTRUCTIONS = `"description" is physical appearance ONLY, written as a comma-separated list of short visual tags, most important first — hair, eyes, build, clothing, notable features (e.g. "long white hair, red eyes, slender, black leather coat, silver pauldron, scar over left eye"). It is used verbatim to generate the member's portrait: no sentences, no personality, no backstory.`;

/* ------------------------------ the built-ins ----------------------------- */

/** The shipped wording for each dialect — also what per-field Reset restores. */
export const TEMPLATE_TEXT: Record<PromptFormat, TemplateText> = {
  prose: {
    portraitAction: DEFAULT_PORTRAIT_ACTION,
    portraitContext: DEFAULT_PORTRAIT_CONTEXT,
    portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
    portraitStyle: DEFAULT_PORTRAIT_STYLE,
    portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    appearanceInstructions: DEFAULT_APPEARANCE_INSTRUCTIONS,
  },
  tags: {
    portraitAction: TAG_PORTRAIT_ACTION,
    portraitContext: TAG_PORTRAIT_CONTEXT,
    portraitComposition: TAG_PORTRAIT_COMPOSITION,
    portraitStyle: TAG_PORTRAIT_STYLE,
    portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION,
    negativePrompt: TAG_NEGATIVE_PROMPT,
    appearanceInstructions: TAG_APPEARANCE_INSTRUCTIONS,
  },
};

/** The names the two shipped templates carry in the picker. */
export const BUILTIN_NAMES: Record<PromptFormat, string> = {
  prose: "Descriptive (chat models)",
  tags: "Tags (SD / ComfyUI)",
};

/** Fresh copies of the two shipped templates. */
export function builtinTemplates(): ImagePromptTemplate[] {
  return PROMPT_FORMATS.map((format) => ({
    id: format === "prose" ? PROSE_TEMPLATE_ID : TAGS_TEMPLATE_ID,
    name: BUILTIN_NAMES[format],
    format,
    ...TEMPLATE_TEXT[format],
  }));
}

/** A new template the player just made, seeded from a dialect's ship text. */
export function newTemplate(name: string, format: PromptFormat): ImagePromptTemplate {
  return { id: templateId(), name, format, ...TEMPLATE_TEXT[format] };
}

/** A copy of `template` under a new id — Duplicate, the way a built-in is edited safely. */
export function duplicateTemplate(
  template: ImagePromptTemplate,
  name: string,
): ImagePromptTemplate {
  return { ...template, id: templateId(), name };
}

function templateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ------------------------------ normalization ----------------------------- */

function isFormat(v: unknown): v is PromptFormat {
  return (PROMPT_FORMATS as readonly string[]).includes(v as string);
}

/**
 * Fold one stored object onto a usable template.
 *
 * A missing text field takes its dialect's ship wording; a BLANK one is kept
 * blank, because blanking a field is how the player removes it — an empty
 * appearance rule drops that whole bullet from the output protocol, and falling
 * back there would make the line undeletable.
 */
function normalizeTemplate(raw: unknown, index: number): ImagePromptTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as Partial<ImagePromptTemplate>;
  const format: PromptFormat = isFormat(stored.format) ? stored.format : "prose";
  const ship = TEMPLATE_TEXT[format];
  const text = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

  return {
    id: typeof stored.id === "string" && stored.id.trim() ? stored.id : `tpl-${index}`,
    name:
      typeof stored.name === "string" && stored.name.trim()
        ? stored.name.trim()
        : BUILTIN_NAMES[format],
    format,
    portraitAction: text(stored.portraitAction, ship.portraitAction),
    portraitContext: text(stored.portraitContext, ship.portraitContext),
    portraitComposition: text(stored.portraitComposition, ship.portraitComposition),
    portraitStyle: text(stored.portraitStyle, ship.portraitStyle),
    portraitRefInstruction: text(stored.portraitRefInstruction, ship.portraitRefInstruction),
    negativePrompt: text(stored.negativePrompt, ship.negativePrompt),
    appearanceInstructions: text(stored.appearanceInstructions, ship.appearanceInstructions),
  };
}

/**
 * Fold whatever localStorage holds onto a usable template list — sanitized at
 * READ time, the way `normalizeDice` and `normalizeComfy` are.
 *
 * `legacy` carries the flat `Settings.portraitStyle` /
 * `appearanceInstructions` / `comfyNegativePrompt` fields these templates
 * replaced. They are folded onto the PROSE built-in rather than becoming a
 * template of their own: the shipped wording is exactly what they held before
 * anyone edited them, so a player who never touched Advanced sees no change and
 * one who did keeps every word — with the tag dialect now sitting beside it.
 *
 * Never returns an empty list: an empty picker would leave no way to draw a
 * prompt and no way back.
 */
export function normalizeImageTemplates(
  stored: unknown,
  legacy: Partial<TemplateText> = {},
): ImagePromptTemplate[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const out: ImagePromptTemplate[] = [];
  for (const [i, raw] of list.entries()) {
    const template = normalizeTemplate(raw, i);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id);
    out.push(template);
  }
  if (out.length) return out;

  return builtinTemplates().map((t) =>
    t.id === PROSE_TEMPLATE_ID ? { ...t, ...pickText(legacy) } : t,
  );
}

/** Only the string keys actually present — an absent legacy field keeps the ship text. */
function pickText(legacy: Partial<TemplateText>): Partial<TemplateText> {
  const out: Partial<TemplateText> = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value === "string") out[key as keyof TemplateText] = value;
  }
  return out;
}

/**
 * The template every image prompt this turn is built from.
 *
 * Falls through rather than failing: a dangling `imageTemplateId` (the player
 * deleted the selected template in another tab, or a save arrived from a build
 * that shipped different ids) takes the first template, and an empty list takes
 * the shipped prose one. There is no state in which an image cannot be prompted.
 */
export function activeTemplate(
  settings: Pick<Settings, "imageTemplates" | "imageTemplateId">,
): ImagePromptTemplate {
  const list = settings.imageTemplates ?? [];
  return (
    list.find((t) => t.id === settings.imageTemplateId) ?? list[0] ?? builtinTemplates()[0]
  );
}
