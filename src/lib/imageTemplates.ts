import { PROMPT_FORMATS } from "../types";
import type { ImagePromptBlock, ImagePromptTemplate, PromptFormat, Settings } from "../types";

/**
 * Image prompt templates (DESIGN.md → Image Generation → Prompt Templates).
 *
 * Everything that decides HOW an image prompt is worded lives in one named,
 * switchable bundle: an ordered list of portrait-prompt blocks, the reference
 * line, the diffusion negative prompt, and the narrator's own appearance rule —
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
 * The portrait clauses are the `blocks.ts` editor's sibling for image prompts:
 * an ordered, player-editable list, reorderable and removable, minus the `kind`
 * tag (a clause plays no mechanical role) and with one block — Appearance, the
 * character's own Subject — locked to reorder-only, since its content isn't
 * typed here at all.
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

/** The one block id every template carries — the Subject injection point. */
export const APPEARANCE_BLOCK_ID = "appearance";

/** Stable ids for the four shipped clause blocks — also the Reset/migration keys. */
export const PORTRAIT_ACTION_BLOCK_ID = "action";
export const PORTRAIT_CONTEXT_BLOCK_ID = "context";
export const PORTRAIT_COMPOSITION_BLOCK_ID = "composition";
export const PORTRAIT_STYLE_BLOCK_ID = "style";

/** The editable half of a template — everything but its identity. */
export type TemplateText = Omit<ImagePromptTemplate, "id" | "name" | "format">;

/**
 * The flat shape a template's four clauses held before the block editor
 * existed — still what a pre-migration save, or `Settings`' own retired
 * top-level fields, carry. Read only for migration.
 */
export interface LegacyTemplateText {
  portraitAction?: string;
  portraitContext?: string;
  portraitComposition?: string;
  portraitStyle?: string;
  portraitRefInstruction?: string;
  negativePrompt?: string;
  appearanceInstructions?: string;
}

/* --------------------------- prose (chat models) -------------------------- */

/*
 * Written as full narrative sentences — Gemini image models respond to
 * descriptions, not keyword lists.
 */

export const DEFAULT_PORTRAIT_ACTION = `Use a vertical portrait orientation with a strict 3:4 aspect ratio. Compose the character specifically for the 3:4 frame, leaving modest space around the head and shoulders while preserving the complete waist-up silhouette. Do not use a square, landscape, or unusually narrow composition.

The character stands upright in a perfectly neutral, still pose. Their arms rest naturally at their sides, their shoulders are square to the camera, their head is level, and their body faces directly forward. Their mouth is closed, their eyes are open and clearly visible, and their expression is calm and neutral. Do not use a dynamic pose, gesture, head tilt, exaggerated expression, or three-quarter angle.`;

export const DEFAULT_PORTRAIT_CONTEXT = `Place the character against a dark charcoal-to-black background with subtle distressed comic-book texture. Include restrained grain, faint ink speckles, and slight rough tonal variation. Keep the background abstract, atmospheric, and unobtrusive, with no scenery, props, recognizable environment, decorative patterns, or competing shapes. Maintain strong separation between the character and the dark background.`;

export const DEFAULT_PORTRAIT_COMPOSITION = `Create a centered waist-up portrait in a vertical 3:4 frame. Show the complete head, neck, shoulders, upper torso, and both arms as far as the crop allows. Use a slightly dynamic three-quarter composition with a clear, readable silhouette and subtle asymmetry. Keep the face prominent and oriented toward the viewer, with one shoulder or side of the torso slightly closer to the camera. Leave modest space around the head and shoulders, and do not crop the face or important identifying features.`;

export const DEFAULT_PORTRAIT_STYLE = `Render the portrait as polished, high-resolution pixel art with clearly visible, intentionally placed square pixels. Use crisp pixel clusters, stepped diagonal edges, hard pixel boundaries, limited-color shading, and deliberate dithering where appropriate. Preserve clean facial features, readable anatomy, strong silhouettes, and recognizable character details at pixel scale. Do not use smooth anti-aliased edges, vector-like curves, blurry transitions, photographic gradients, or painterly brushwork. The result should look deliberately pixel-crafted rather than like a smooth illustration with a pixel filter applied.

Vibrant, high-energy Western superhero-comic pixel art with pronounced anime influence and a polished late-1990s comic-book sensibility. Combine bold graphic silhouettes, exaggerated heroic anatomy, dramatic ink-inspired contours, saturated jewel-tone colors, vivid accent colors, and crisp cel-shaded pixel clusters. Use large, readable shadow masses, selective black accents, bright highlights, and strong color separation. Emphasize the contrast between hard mechanical forms and soft organic or synthetic surfaces through distinct pixel textures and shading patterns.

Use a dark charcoal-to-black background with subtle distressed comic-book grain, restrained pixel dithering, faint ink-like speckles, and rough tonal variation. Add a selective bright pixel rim light around parts of the silhouette to separate the character from the background. Keep the final image energetic, colorful, graphic, readable, and intentionally pixel-crafted.`;

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
 * sentences.
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

/**
 * The shipped block list for a dialect — Appearance leads (Subject → Action →
 * Location/context → Composition → Style, the Nano Banana formula) since that
 * is the order every template starts in; the player is free to move it.
 */
function defaultBlocks(format: PromptFormat): ImagePromptBlock[] {
  const text =
    format === "tags"
      ? {
          action: TAG_PORTRAIT_ACTION,
          context: TAG_PORTRAIT_CONTEXT,
          composition: TAG_PORTRAIT_COMPOSITION,
          style: TAG_PORTRAIT_STYLE,
        }
      : {
          action: DEFAULT_PORTRAIT_ACTION,
          context: DEFAULT_PORTRAIT_CONTEXT,
          composition: DEFAULT_PORTRAIT_COMPOSITION,
          style: DEFAULT_PORTRAIT_STYLE,
        };
  return [
    { id: APPEARANCE_BLOCK_ID, type: "appearance" },
    { id: PORTRAIT_ACTION_BLOCK_ID, type: "text", title: "Portrait Action", text: text.action },
    {
      id: PORTRAIT_CONTEXT_BLOCK_ID,
      type: "text",
      title: "Portrait Location/Context",
      text: text.context,
    },
    {
      id: PORTRAIT_COMPOSITION_BLOCK_ID,
      type: "text",
      title: "Portrait Composition",
      text: text.composition,
    },
    { id: PORTRAIT_STYLE_BLOCK_ID, type: "text", title: "Portrait Style", text: text.style },
  ];
}

/** The legacy flat field each shipped block id migrates from. */
const LEGACY_BLOCK_FIELD: Partial<Record<string, keyof LegacyTemplateText>> = {
  [PORTRAIT_ACTION_BLOCK_ID]: "portraitAction",
  [PORTRAIT_CONTEXT_BLOCK_ID]: "portraitContext",
  [PORTRAIT_COMPOSITION_BLOCK_ID]: "portraitComposition",
  [PORTRAIT_STYLE_BLOCK_ID]: "portraitStyle",
};

/** The shipped wording for each dialect — also what per-field Reset restores. */
export const TEMPLATE_TEXT: Record<PromptFormat, TemplateText> = {
  prose: {
    blocks: defaultBlocks("prose"),
    portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    appearanceInstructions: DEFAULT_APPEARANCE_INSTRUCTIONS,
  },
  tags: {
    blocks: defaultBlocks("tags"),
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

function cloneBlock(block: ImagePromptBlock): ImagePromptBlock {
  return { ...block };
}

/** Fresh copies of the two shipped templates. */
export function builtinTemplates(): ImagePromptTemplate[] {
  return PROMPT_FORMATS.map((format) => ({
    id: format === "prose" ? PROSE_TEMPLATE_ID : TAGS_TEMPLATE_ID,
    name: BUILTIN_NAMES[format],
    format,
    ...TEMPLATE_TEXT[format],
    blocks: TEMPLATE_TEXT[format].blocks.map(cloneBlock),
  }));
}

/** A new template the player just made, seeded from a dialect's ship text. */
export function newTemplate(name: string, format: PromptFormat): ImagePromptTemplate {
  return {
    id: templateId(),
    name,
    format,
    ...TEMPLATE_TEXT[format],
    blocks: TEMPLATE_TEXT[format].blocks.map(cloneBlock),
  };
}

/** A copy of `template` under a new id — Duplicate, the way a built-in is edited safely. */
export function duplicateTemplate(
  template: ImagePromptTemplate,
  name: string,
): ImagePromptTemplate {
  return { ...template, id: templateId(), name, blocks: template.blocks.map(cloneBlock) };
}

function templateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A fresh id for a player-added block — never reused, the React key and the move/remove target. */
function blockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A fresh Text block — what a "+ Block" tap in the prompt editor produces. */
export function makeImagePromptBlock(title = "", text = ""): ImagePromptBlock {
  return { id: blockId(), type: "text", title, text };
}

/**
 * Swap a block with its neighbour in `dir` — the prompt editor's Move Up/Move
 * Down, `blocks.ts → moveBlock`'s sibling. Clamped: a no-op index returns the
 * SAME array reference.
 */
export function moveImagePromptBlock(
  blocks: ImagePromptBlock[],
  index: number,
  dir: -1 | 1,
): ImagePromptBlock[] {
  const target = index + dir;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return blocks;
  }
  const out = blocks.slice();
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/* ------------------------------ normalization ----------------------------- */

function isFormat(v: unknown): v is PromptFormat {
  return (PROMPT_FORMATS as readonly string[]).includes(v as string);
}

/**
 * Fold a stored template's blocks onto a usable list.
 *
 * A template saved before the block editor existed carries the four clauses as
 * flat strings instead of `blocks` — folded onto the shipped block SHAPE here so
 * a player's customized wording survives the upgrade, landing at the same
 * position the fixed fields always rendered in. A template saved after has
 * `blocks` already; each row is validated on its own (an unreadable one is
 * dropped rather than failing the whole list), and a missing Appearance block is
 * reinserted at the top — a portrait with no Subject can't be built, so the one
 * state the block editor refuses is also the one normalization refuses.
 */
function normalizeBlocks(
  raw: unknown,
  format: PromptFormat,
  legacy: LegacyTemplateText,
): ImagePromptBlock[] {
  if (!Array.isArray(raw)) {
    return TEMPLATE_TEXT[format].blocks.map((b) => {
      if (b.type !== "text") return cloneBlock(b);
      const field = LEGACY_BLOCK_FIELD[b.id];
      const stored = field ? legacy[field] : undefined;
      return typeof stored === "string" ? { ...b, text: stored } : cloneBlock(b);
    });
  }

  const out: ImagePromptBlock[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const stored = row as { id?: unknown; type?: unknown; title?: unknown; text?: unknown };
    const id = typeof stored.id === "string" && stored.id.trim() ? stored.id : blockId();
    if (seen.has(id)) continue;
    seen.add(id);
    if (stored.type === "appearance") {
      out.push({ id, type: "appearance" });
    } else {
      out.push({
        id,
        type: "text",
        title: typeof stored.title === "string" ? stored.title : "",
        text: typeof stored.text === "string" ? stored.text : "",
      });
    }
  }
  if (!out.some((b) => b.type === "appearance")) {
    out.unshift({ id: APPEARANCE_BLOCK_ID, type: "appearance" });
  }
  return out;
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
  const stored = raw as Partial<ImagePromptTemplate> & LegacyTemplateText;
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
    blocks: normalizeBlocks(stored.blocks, format, stored),
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
  legacy: LegacyTemplateText = {},
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
    t.id === PROSE_TEMPLATE_ID
      ? { ...t, ...pickText(legacy), blocks: normalizeBlocks(undefined, "prose", legacy) }
      : t,
  );
}

/** Only the string keys actually present — an absent legacy field keeps the ship text. */
function pickText(legacy: LegacyTemplateText): Partial<TemplateText> {
  const out: Partial<TemplateText> = {};
  if (typeof legacy.portraitRefInstruction === "string") {
    out.portraitRefInstruction = legacy.portraitRefInstruction;
  }
  if (typeof legacy.negativePrompt === "string") out.negativePrompt = legacy.negativePrompt;
  if (typeof legacy.appearanceInstructions === "string") {
    out.appearanceInstructions = legacy.appearanceInstructions;
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
