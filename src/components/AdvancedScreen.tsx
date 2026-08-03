import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, ToggleRow, btnSmall } from "./fields";
import type { ImagePromptTemplate, PromptFormat, Settings } from "../types";
import {
  DEFAULT_CHARACTER_CREATION_INSTRUCTIONS,
  DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_DEPARTURE_INSTRUCTIONS,
  DEFAULT_JOURNAL_INSTRUCTIONS,
  DEFAULT_OPTION_INSTRUCTIONS,
  DEFAULT_SPOTLIGHT_RULE,
  DEFAULT_STANDING_INSTRUCTIONS,
} from "../lib/defaults";
import {
  activeTemplate,
  duplicateTemplate,
  newTemplate,
  TEMPLATE_TEXT,
  type TemplateText,
} from "../lib/imageTemplates";
import { useConfirm } from "./useConfirm";
import {
  blobToRefImage,
  clampBannerCooldown,
  imagesAllowed,
  MAX_BANNER_COOLDOWN,
  MAX_REF_IMAGES,
  refImageToDataUrl,
} from "../lib/images";
import {
  clampHistoryBudget,
  MAX_HISTORY_BUDGET,
  MIN_HISTORY_BUDGET,
} from "../lib/prompt";
import {
  clampJournalBudget,
  clampJournalMaxTurns,
  clampJournalMinTurns,
  clampMaxTokens,
  MAX_BEAT_TOKENS,
  MAX_JOURNAL_BUDGET,
  MAX_JOURNAL_TURNS,
  MIN_JOURNAL_TURNS,
} from "../lib/settings";

/**
 * Advanced instructions (DESIGN.md → Menu): the player-editable prompt guidance
 * that steers the narrator, the character writer, the spotlight, and the image
 * models. Each field has a Reset to restore its ship default.
 *
 * One flat scroll of a dozen textareas was unreadable on a phone, so this is an
 * INDEX of sub-menus — Narrator · Characters · Images · Image Prompts — each opening
 * its own panel. The depth is local state, not a `Screen`: the sub-menus are one
 * screen's internal structure, and routing them would put four more entries in
 * the store's navigation history for no gain.
 *
 * Portrait Subject (name/species/description) is never editable here — it's
 * always auto-built from the character, per the Nano Banana Subject → Action
 * → Location/context → Composition → Style formula (loom-turn-protocol adjacent
 * but lives in images.ts).
 */
type InstrKey = keyof Pick<
  Settings,
  | "customInstructions"
  | "optionInstructions"
  | "journalInstructions"
  | "spotlightRule"
  | "characterCreationInstructions"
  | "characterUpdateInstructions"
  | "standingInstructions"
  | "departureInstructions"
>;

interface InstrSpec {
  key: InstrKey;
  label: string;
  def: string;
  rows: number;
  /** One line under the field saying what this text actually steers. */
  hint?: string;
}

type SectionId = "narrator" | "characters" | "images" | "prompts";

const SECTIONS: { id: SectionId; label: string; note: string }[] = [
  { id: "narrator", label: "Narrator", note: "Voice · tone · suggested actions" },
  { id: "characters", label: "Characters", note: "How the story writes your cast" },
  { id: "images", label: "Images", note: "1-bit shading · location art" },
  {
    id: "prompts",
    label: "Image Prompts",
    note: "Prompt templates · banner · portraits · references",
  },
];

const NARRATOR_FIELDS: InstrSpec[] = [
  {
    key: "customInstructions",
    label: "Narrator Instructions",
    def: DEFAULT_CUSTOM_INSTRUCTIONS,
    rows: 8,
    hint: "The narrator's craft — voice, pacing, tone. Setting and genre come from the Scenario.",
  },
];

const OPTION_FIELD: InstrSpec = {
  key: "optionInstructions",
  label: "Action Options",
  def: DEFAULT_OPTION_INSTRUCTIONS,
  rows: 3,
  hint: "How the suggested actions under each beat are written.",
};

const JOURNAL_FIELD: InstrSpec = {
  key: "journalInstructions",
  label: "Journal Entries",
  def: DEFAULT_JOURNAL_INSTRUCTIONS,
  rows: 5,
  hint: "How a day's entry is written. Quests, joins, departures and marks are recorded by the app itself and never asked for.",
};

/**
 * Everything that steers how the story handles characters, in the order a
 * character meets it: how they look, how they're born, what stays frozen
 * afterwards, where they sit, how they leave, and when they speak.
 */
const CHARACTER_FIELDS: InstrSpec[] = [
  {
    key: "characterCreationInstructions",
    label: "Character Creation",
    def: DEFAULT_CHARACTER_CREATION_INSTRUCTIONS,
    rows: 4,
    hint: "What the narrator must fill in when it introduces someone — sheet fields and their starting gear. This is its only chance; sheets freeze afterwards.",
  },
  {
    key: "characterUpdateInstructions",
    label: "Sheet Updates",
    def: DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS,
    rows: 4,
    hint: "The freeze rule. Appearance, personality, drive, strengths, flaws and equipment are ignored after creation whatever this says — this just stops the narrator trying.",
  },
  {
    key: "standingInstructions",
    label: "Standings",
    def: DEFAULT_STANDING_INSTRUCTIONS,
    rows: 4,
    hint: "How the narrator seats a character: travelling with you, benched, or an NPC of the world.",
  },
  {
    key: "departureInstructions",
    label: "Departures",
    def: DEFAULT_DEPARTURE_INSTRUCTIONS,
    rows: 3,
    hint: "How someone leaves the party — walked away, or died. Nothing the narrator writes ever deletes a character.",
  },
  {
    key: "spotlightRule",
    label: "Spotlight Rule",
    def: DEFAULT_SPOTLIGHT_RULE,
    rows: 4,
    hint: "When a party member gets a spoken line of their own.",
  },
];

/**
 * The template's own fields, in the order a prompt is assembled: the appearance
 * rule that writes the Subject, then the banner, then the four portrait clauses,
 * then the negative prompt.
 */
interface TemplateSpec {
  key: keyof TemplateText;
  label: string;
  rows: number;
  hint?: string;
}

const TEMPLATE_FIELDS: TemplateSpec[] = [
  {
    key: "appearanceInstructions",
    label: "Appearance Descriptions",
    rows: 4,
    hint: "How the narrator writes a new character's appearance — it becomes their portrait prompt verbatim, which is why it belongs to the template. Existing characters keep the appearance they were written with.",
  },
  {
    key: "bannerInstructions",
    label: "Banner Style",
    rows: 4,
    hint: "The art style for location images.",
  },
  { key: "portraitAction", label: "Portrait Action", rows: 3 },
  { key: "portraitContext", label: "Portrait Location/Context", rows: 2 },
  { key: "portraitComposition", label: "Portrait Composition", rows: 2 },
  { key: "portraitStyle", label: "Portrait Style", rows: 5 },
  {
    key: "negativePrompt",
    label: "Negative Prompt",
    rows: 3,
    hint: "What to keep out of the picture. ComfyUI only — the OpenRouter image model takes no negative prompt.",
  },
];

const FORMAT_LABEL: Record<PromptFormat, string> = {
  prose: "DESCRIPTIVE",
  tags: "TAGS",
};

/** One instruction textarea + its Reset, driven straight off the store. */
function InstrField({ spec }: { spec: InstrSpec }) {
  const value = useStore((s) => s.settings[spec.key]);
  const update = useStore((s) => s.updateSettings);
  return (
    <Field label={spec.label}>
      <textarea
        value={value}
        rows={spec.rows}
        onChange={(e) => update({ [spec.key]: e.target.value })}
        className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
      />
      {spec.hint && <p className="text-xs opacity-70">{spec.hint}</p>}
      <button
        type="button"
        onClick={() => update({ [spec.key]: spec.def })}
        disabled={value === spec.def}
        className={`mt-1 ${btnSmall}`}
      >
        Reset to default
      </button>
    </Field>
  );
}

function NarratorSection() {
  const showActionOptions = useStore((s) => s.settings.showActionOptions);
  const historyBudget = useStore((s) => s.settings.historyBudget);
  const maxTokens = useStore((s) => s.settings.maxTokens);
  const journalEnabled = useStore((s) => s.settings.journalEnabled);
  const journalBudget = useStore((s) => s.settings.journalBudget);
  const journalMaxTurns = useStore((s) => s.settings.journalMaxTurns);
  const journalMinTurns = useStore((s) => s.settings.journalMinTurns);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      {NARRATOR_FIELDS.map((f) => (
        <InstrField key={f.key} spec={f} />
      ))}
      <ToggleRow
        label="AI Suggested Actions"
        state={showActionOptions ? "ON" : "OFF"}
        onClick={() => update({ showActionOptions: !showActionOptions })}
      />
      {showActionOptions && <InstrField spec={OPTION_FIELD} />}

      <Field label="Memory — Turns Kept">
        <input
          type="number"
          inputMode="numeric"
          min={MIN_HISTORY_BUDGET}
          max={MAX_HISTORY_BUDGET}
          step={500}
          value={historyBudget}
          onChange={(e) => update({ historyBudget: clampHistoryBudget(e.target.valueAsNumber) })}
          className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
        />
        <p className="text-xs opacity-70">
          Roughly how many tokens of recent story the narrator is shown each turn.
          Beyond this, older beats are dropped — what the narrator wrote into World
          Notes is what survives. Raise it on a large-context model; every turn pays
          for it.
        </p>
      </Field>

      <Field label="Beat Length Limit">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_BEAT_TOKENS}
          step={100}
          value={maxTokens}
          onChange={(e) => update({ maxTokens: clampMaxTokens(e.target.valueAsNumber) })}
          className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
        />
        <p className="text-xs opacity-70">
          Hard cap on one beat, in tokens. 0 removes the cap and lets the model run as
          long as it likes. Too low and the machine block at the end of a beat gets
          cut off mid-write.
        </p>
      </Field>

      {/* The journal sits directly under the history budget on purpose: they
          compete for the same context, and the trade only makes sense read
          together. */}
      <ToggleRow
        label="Journal"
        state={journalEnabled ? "ON" : "OFF"}
        onClick={() => update({ journalEnabled: !journalEnabled })}
      />
      {journalEnabled && (
        <>
          <Field label="Memory — Journal Size">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_JOURNAL_BUDGET}
              step={100}
              value={journalBudget}
              onChange={(e) =>
                update({ journalBudget: clampJournalBudget(e.target.valueAsNumber) })
              }
              className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <p className="text-xs opacity-70">
              Roughly how many tokens of journal the narrator is shown each turn, newest
              entries first. Older entries keep only the facts the app recorded before
              dropping out of the prompt — they stay on the Journal screen either way.
            </p>
          </Field>

          <Field label="Journal — Longest Gap">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_JOURNAL_TURNS}
              max={MAX_JOURNAL_TURNS}
              step={1}
              value={journalMaxTurns}
              onChange={(e) =>
                update({ journalMaxTurns: clampJournalMaxTurns(e.target.valueAsNumber) })
              }
              className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <p className="text-xs opacity-70">
              An entry is normally written when the party sleeps into a new day. This is
              the ceiling: after this many turns without one, an entry is written anyway.
            </p>
          </Field>

          <Field label="Journal — Shortest Entry">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_JOURNAL_TURNS}
              max={MAX_JOURNAL_TURNS}
              step={1}
              value={journalMinTurns}
              onChange={(e) =>
                update({ journalMinTurns: clampJournalMinTurns(e.target.valueAsNumber) })
              }
              className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <p className="text-xs opacity-70">
              A stretch shorter than this folds into the next entry instead of becoming
              one of its own — a day crossed on the second turn is not a day.
            </p>
          </Field>

          <InstrField spec={JOURNAL_FIELD} />
        </>
      )}
    </>
  );
}

function CharactersSection() {
  return (
    <>
      <p className="border-2 border-ink p-3 text-sm">
        A character's sheet is written once, when the story first introduces them, and
        is frozen after that: the narrator can move them between standings, but their
        appearance, personality, drive, strengths, flaws and equipment stay yours. Use the member sheet's
        Auto-Update to re-read a sheet from the story on purpose.
      </p>
      <p className="text-xs opacity-70">
        How an appearance is written lives under Image Prompts — it becomes the
        character's portrait prompt verbatim, so it belongs with the rest of the image
        wording.
      </p>
      {CHARACTER_FIELDS.map((f) => (
        <InstrField key={f.key} spec={f} />
      ))}
    </>
  );
}

/**
 * Shown at the top of the two image sections while the master switch (Model &
 * Key → Image Generation) is off. The fields under it still edit fine and are
 * still worth setting up ahead of time — but nothing here draws anything while
 * that switch is off, and silently editing prompts that never run is worse than
 * one line of explanation.
 */
function GenerationOffNote() {
  const enabled = useStore((s) => imagesAllowed(s.settings));
  if (enabled) return null;
  return (
    <p className="border-2 border-ink p-3 text-sm">
      Image generation is switched off under Menu → Model &amp; Key. These settings are
      kept and take effect the moment you switch it back on.
    </p>
  );
}

/**
 * The same courtesy for the reference images, which are the one thing on these
 * screens the ComfyUI backend genuinely cannot use — a workflow the player
 * wrote has no agreed place to put a style image, and pretending otherwise
 * would mean uploads that quietly do nothing.
 */
function ComfyRefNote() {
  const comfy = useStore((s) => imagesAllowed(s.settings) && s.settings.imageBackend === "comfyui");
  if (!comfy) return null;
  return (
    <p className="border-2 border-ink p-3 text-sm">
      Pictures are being drawn by ComfyUI, which doesn't take reference images — the
      prompt below still steers it, but build the art style into the workflow. These are
      kept for whenever OpenRouter is selected again.
    </p>
  );
}

/** The selected template plus a writer for it — every image-prompt control needs both. */
function useActiveTemplate() {
  const templates = useStore((s) => s.settings.imageTemplates);
  const imageTemplateId = useStore((s) => s.settings.imageTemplateId);
  const update = useStore((s) => s.updateSettings);
  const template = activeTemplate({ imageTemplates: templates, imageTemplateId });

  /** Write fields onto the SELECTED template — edits land live, like every other setting. */
  const patch = (fields: Partial<ImagePromptTemplate>) =>
    update({
      imageTemplates: templates.map((t) => (t.id === template.id ? { ...t, ...fields } : t)),
    });

  return { templates, template, patch, update };
}

/** One template textarea + its Reset, which restores the ship text for that DIALECT. */
function TemplateField({ spec }: { spec: TemplateSpec }) {
  const { template, patch } = useActiveTemplate();
  const value = template[spec.key];
  const def = TEMPLATE_TEXT[template.format][spec.key];
  return (
    <Field label={spec.label}>
      <textarea
        value={value}
        rows={spec.rows}
        onChange={(e) => patch({ [spec.key]: e.target.value })}
        className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
      />
      {spec.hint && <p className="text-xs opacity-70">{spec.hint}</p>}
      <button
        type="button"
        onClick={() => patch({ [spec.key]: def })}
        disabled={value === def}
        className={`mt-1 ${btnSmall}`}
      >
        Reset to default
      </button>
    </Field>
  );
}

/**
 * Pick / name / add / copy / delete a template. The name is a live field rather
 * than a Rename button behind a dialog — the app has no text prompt, and a
 * settings screen editing its own row is the same gesture as everything else
 * here.
 */
function TemplateManager({ ask }: { ask: ReturnType<typeof useConfirm>["ask"] }) {
  const { templates, template, patch, update } = useActiveTemplate();

  function select(id: string) {
    update({ imageTemplateId: id });
  }

  function add(made: ImagePromptTemplate) {
    update({ imageTemplates: [...templates, made], imageTemplateId: made.id });
  }

  function remove() {
    const rest = templates.filter((t) => t.id !== template.id);
    if (!rest.length) return;
    update({ imageTemplates: rest, imageTemplateId: rest[0].id });
  }

  return (
    <section className="space-y-3 border-2 border-ink p-3">
      <h2 className="uppercase tracking-widest">Prompt Template</h2>
      <p className="text-sm">
        Which wording every image prompt is built from. Descriptive templates suit chat
        image models; tag templates suit the SD-family checkpoints ComfyUI runs.
      </p>

      <select
        value={template.id}
        onChange={(e) => select(e.target.value)}
        aria-label="Prompt template"
        className="w-full appearance-none border-2 border-ink bg-paper p-2 focus:outline-none"
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      <Field label="Template Name">
        <input
          value={template.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
        />
      </Field>

      {/* Structure, not wording: it decides whether the parts are joined as
          paragraphs or comma-separated tags, and whether the character's name
          and the field labels are emitted at all. */}
      <ToggleRow
        label="Prompt Format"
        state={FORMAT_LABEL[template.format]}
        onClick={() => patch({ format: template.format === "prose" ? "tags" : "prose" })}
      />
      <p className="text-xs opacity-70">
        {template.format === "tags"
          ? "Tags: the parts below are stripped of trailing punctuation and joined with commas. Labels are dropped, and a portrait leaves the character's NAME out — a diffusion model can't read it and the tokens are scarce."
          : "Descriptive: the parts below are kept as labelled paragraphs, the way a chat image model reads a scene."}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => add(newTemplate("New Template", template.format))}
          className={btnSmall}
        >
          New
        </button>
        <button
          type="button"
          onClick={() => add(duplicateTemplate(template, `${template.name} copy`))}
          className={btnSmall}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={templates.length < 2}
          onClick={() =>
            ask(
              {
                title: `Delete "${template.name}"?`,
                body: "The wording in it is lost. Images already generated are kept.",
                confirmLabel: "Delete",
              },
              remove,
            )
          }
          className={btnSmall}
        >
          Delete
        </button>
      </div>
      <p className="text-xs opacity-70">
        The two shipped templates can be edited freely — Reset to default under each
        field restores the wording for the format it's set to. Duplicate first if you'd
        rather keep the original around.
      </p>
    </section>
  );
}

/** Portrait style references — files, so they belong to the app rather than to a template. */
function ReferenceImages() {
  const refs = useStore((s) => s.settings.portraitRefImages);
  const update = useStore((s) => s.updateSettings);
  const fileInput = useRef<HTMLInputElement>(null);

  async function addRef(file: File) {
    if (refs.length >= MAX_REF_IMAGES) return;
    try {
      const ref = await blobToRefImage(file);
      update({ portraitRefImages: [...useStore.getState().settings.portraitRefImages, ref] });
    } catch {
      // An unreadable file just doesn't get added — nothing to break.
    }
  }

  function removeRef(index: number) {
    update({ portraitRefImages: refs.filter((_, i) => i !== index) });
  }

  function moveRef(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= refs.length) return;
    const next = [...refs];
    [next[index], next[to]] = [next[to], next[index]];
    update({ portraitRefImages: next });
  }

  return (
    <section className="space-y-3 border-2 border-ink p-3">
      <h2 className="uppercase tracking-widest">Portrait Style References</h2>
      <p className="text-sm">
        These images teach the art style used for all character portraits. They aren't
        part of a template — the same references are what "our art style" means whichever
        wording describes it.
      </p>

      {refs.length > 0 && (
        <ul className="space-y-2">
          {refs.map((ref, i) => (
            <li key={i} className="flex items-center gap-2 border-2 border-ink p-2">
              <img
                src={refImageToDataUrl(ref)}
                alt={`Style reference ${i + 1}`}
                className="h-16 w-16 border-2 border-ink object-cover [image-rendering:pixelated]"
              />
              <span className="flex-1 text-sm uppercase tracking-widest">Ref {i + 1}</span>
              <button type="button" onClick={() => moveRef(i, -1)} disabled={i === 0} className={btnSmall}>
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveRef(i, 1)}
                disabled={i === refs.length - 1}
                className={btnSmall}
              >
                ↓
              </button>
              <button type="button" onClick={() => removeRef(i)} className={btnSmall}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void addRef(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={refs.length >= MAX_REF_IMAGES}
        className={btnSmall}
      >
        Add Reference Image ({refs.length}/{MAX_REF_IMAGES})
      </button>
      <p className="text-xs opacity-70">
        Best with 2–3 visually varied references (e.g. a humanoid male, a humanoid
        female, and a non-humanoid) rather than a single one — when they differ in
        everything except the ink style, the model learns that the style is the
        constant, so body types and gear don't bleed into your characters.
      </p>

      <TemplateField
        spec={{
          key: "portraitRefInstruction",
          label: "Reference Instruction",
          rows: 3,
          hint: "Sent only when references ride along, so it belongs to the wording — a tag template says it in tags.",
        }}
      />
    </section>
  );
}

function ImagePromptsSection() {
  const { ask, dialog } = useConfirm();
  return (
    <>
      <GenerationOffNote />
      <ComfyRefNote />
      <TemplateManager ask={ask} />
      {TEMPLATE_FIELDS.map((f) => (
        <TemplateField key={f.key} spec={f} />
      ))}
      <ReferenceImages />
      {dialog}
    </>
  );
}

function ImagesSection() {
  const ditherMode = useStore((s) => s.settings.ditherMode);
  const locationImages = useStore((s) => s.settings.locationImages);
  const bannerCooldown = useStore((s) => s.settings.bannerCooldown);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <GenerationOffNote />

      <ToggleRow
        label="1-Bit Shading"
        state={ditherMode === "bayer4" ? "DITHER" : ditherMode === "off" ? "OFF" : "THRESHOLD"}
        onClick={() =>
          update({
            // Cycle THRESHOLD → DITHER → OFF; "off" skips the 1-bit pass
            // entirely and keeps the raw model output.
            ditherMode:
              ditherMode === "threshold" ? "bayer4" : ditherMode === "bayer4" ? "off" : "threshold",
          })
        }
      />

      <ToggleRow
        label="Location Images"
        state={locationImages ? "ON" : "OFF"}
        onClick={() => update({ locationImages: !locationImages })}
      />

      {locationImages ? (
        <>
          <Field label="Location Image Cooldown">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_BANNER_COOLDOWN}
              step={1}
              value={bannerCooldown}
              onChange={(e) =>
                update({ bannerCooldown: clampBannerCooldown(e.target.valueAsNumber) })
              }
              className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <p className="text-xs opacity-70">
              Turns to wait after a location image is generated before another one is
              drawn — "3" skips the next 3 turns' worth of new locations. 0 turns it off.
              Locations you've already seen still show their cached image instantly.
            </p>
          </Field>

          <p className="text-xs opacity-70">
            The art style for a location image lives under Image Prompts, with the rest
            of the wording.
          </p>
        </>
      ) : (
        <p className="border-2 border-ink p-3 text-sm opacity-70">
          Off: no image is drawn for a location and the banner is hidden. Character
          portraits are unaffected. Images already generated are kept, and turning this
          back on shows them again.
        </p>
      )}
    </>
  );
}

const SECTION_BODY: Record<SectionId, () => React.ReactElement> = {
  narrator: NarratorSection,
  characters: CharactersSection,
  images: ImagesSection,
  prompts: ImagePromptsSection,
};

export function AdvancedScreen() {
  const [section, setSection] = useState<SectionId | null>(null);
  const setBackHandler = useStore((s) => s.setBackHandler);
  const open = SECTIONS.find((s) => s.id === section);

  // Claim Back while a sub-menu is open, so it pops to this index rather than
  // out of Advanced. Registered in the store, not passed to the header, so the
  // ANDROID back button does the same thing as the on-screen one.
  useEffect(() => {
    if (!section) return;
    setBackHandler(() => {
      setSection(null);
      return true;
    });
    return () => setBackHandler(null);
  }, [section, setBackHandler]);

  if (open) {
    const Body = SECTION_BODY[open.id];
    return (
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
        <OverlayHeader title={open.label} />
        <div className="flex-1 space-y-5 overflow-y-auto p-3">
          <Body />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Advanced" />
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className="block w-full border-2 border-ink p-3 text-left active:bg-ink active:text-paper"
          >
            <div className="font-bold uppercase tracking-wide">{s.label}</div>
            <div className="mt-1 text-sm opacity-70">{s.note}</div>
          </button>
        ))}
      </div>
    </main>
  );
}
