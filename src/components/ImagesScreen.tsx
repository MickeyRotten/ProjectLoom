import { useRef, useState } from "react";
import { useStore, type PurgeSummary } from "../store";
import { MenuLink, SUBMENU_INDEX, SubMenuScreen, type SubMenuSection } from "./SubMenuScreen";
import { Field, SegmentedRow, ToggleRow, btnSmall } from "./fields";
import { KeyField } from "./KeyField";
import { ModelPicker } from "./ModelPicker";
import { splitModels, useModelCatalog } from "./useModelCatalog";
import { ComfyFields } from "./ComfyFields";
import { useConfirm } from "./useConfirm";
import type {
  DitherMode,
  ImageBackend,
  ImagePromptTemplate,
  PromptFormat,
} from "../types";
import {
  activeTemplate,
  duplicateTemplate,
  newTemplate,
  TEMPLATE_TEXT,
  type TemplateText,
} from "../lib/imageTemplates";
import {
  blobToRefImage,
  clampBannerCooldown,
  imagesAllowed,
  MAX_BANNER_COOLDOWN,
  MAX_REF_IMAGES,
  refImageToDataUrl,
  type ImageKind,
} from "../lib/images";

/**
 * Everything that draws a picture, in one place (DESIGN.md → Menu).
 *
 * It used to be four places — the master switch and the backend under *Model &
 * Key*, the behaviour under *Advanced → Images*, every word of every prompt
 * under *Advanced → Image Prompts*, and the banner size loose on the root menu —
 * so "why is there no picture?" had four possible answers and no route between
 * them. One screen, four sub-menus, and the two settings that apply to every
 * image on the index above them.
 *
 * Portrait Subject (name/species/description) is never editable here — it's
 * always auto-built from the character, per the Nano Banana Subject → Action →
 * Location/context → Composition → Style formula (lives in `images.ts`).
 */
const IMAGE_BACKENDS: { value: ImageBackend; label: string }[] = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "comfyui", label: "ComfyUI" },
];

/** One line under the picker explaining the backend that is actually selected. */
const BACKEND_NOTES: Record<ImageBackend, string> = {
  openrouter:
    "Pictures are drawn in the cloud and billed to your key. Works anywhere, needs no setup.",
  comfyui:
    "Pictures are drawn by a ComfyUI server you run yourself. Free to render, and your own models — but it has to be running and reachable from this device.",
};

/**
 * `off` skips the 1-bit pass entirely and keeps the raw model output. Three
 * buttons rather than the cycling toggle this used to be: a `ToggleRow` can only
 * say what the value is now, so a third state was unreachable without tapping
 * blind.
 */
const DITHER_MODES: { value: DitherMode; label: string }[] = [
  { value: "threshold", label: "Threshold" },
  { value: "bayer4", label: "Dither" },
  { value: "off", label: "Off" },
];

const DITHER_NOTES: Record<DitherMode, string> = {
  threshold: "Every pixel goes to black or white at a hard cutoff. Crisp lines, flat areas.",
  bayer4: "A 4×4 ordered pattern fakes the greys between black and white. Softer, busier.",
  off: "The 1-bit pass is skipped and the model's own output is kept as it came.",
};

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

/**
 * Shown at the top of every sub-menu while the master switch is off. The fields
 * under it still edit fine and are still worth setting up ahead of time — but
 * nothing here draws anything while that switch is off, and silently editing
 * prompts that never run is worse than one line of explanation.
 */
function GenerationOffNote() {
  const enabled = useStore((s) => imagesAllowed(s.settings));
  if (enabled) return null;
  return (
    <p className="border-2 border-ink p-3 text-sm">
      Image generation is switched off — see{" "}
      <MenuLink screen="images" section={SUBMENU_INDEX}>
        Image Generation
      </MenuLink>{" "}
      at the top of this screen. These settings are kept and take effect the moment you
      switch it back on.
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

/** Which machine draws, and what it needs to be reachable. */
function ModelSection() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const { models, loading, error } = useModelCatalog();
  const { image } = splitModels(models);

  return (
    <>
      <GenerationOffNote />

      {/* The two backends want completely different fields — a key and a model
          id, or an address and a workflow — so the unselected one's controls go
          away rather than sit there configuring nothing. Both sets are kept
          either way, so switching back and forth costs no retyping. */}
      <SegmentedRow
        label="Image Backend"
        value={settings.imageBackend}
        options={IMAGE_BACKENDS}
        onChange={(v) => update({ imageBackend: v })}
        columns={2}
        note={<p className="text-xs opacity-70">{BACKEND_NOTES[settings.imageBackend]}</p>}
      />

      {settings.imageBackend === "comfyui" ? (
        <ComfyFields />
      ) : (
        <>
          <KeyField
            label="Image API Key"
            value={settings.imageKey}
            onChange={(v) => update({ imageKey: v })}
            placeholder="Optional — blank uses the text key"
            hint="Separate key billed for image generation. Leave blank to reuse the OpenRouter API Key under Narrator → Model."
          />

          <ModelPicker
            label="Image Model"
            value={settings.imageModelId}
            onChange={(v) => update({ imageModelId: v })}
            models={image}
            loading={loading}
            error={error}
          />
        </>
      )}
    </>
  );
}

/** Whether the top bar carries art at all, how tall it is, and how often it redraws. */
function LocationSection() {
  const locationImages = useStore((s) => s.settings.locationImages);
  const bannerSize = useStore((s) => s.settings.bannerSize);
  const bannerCooldown = useStore((s) => s.settings.bannerCooldown);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <GenerationOffNote />

      <ToggleRow
        label="Location Images"
        state={locationImages ? "ON" : "OFF"}
        onClick={() => update({ locationImages: !locationImages })}
      />

      {locationImages ? (
        <>
          {/* Sizing the banner belongs with the switch that creates it. It used
              to sit loose on the root menu, appearing and disappearing with a
              toggle three levels deep in Advanced. */}
          <ToggleRow
            label="Compact Location Image"
            state={bannerSize === "compact" ? "ON" : "OFF"}
            onClick={() => update({ bannerSize: bannerSize === "compact" ? "full" : "compact" })}
          />
          <p className="text-xs opacity-70">
            The top bar carries the location's art. Compact is a thin strip; off is the
            double-height bar.
          </p>

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
            The art style for a location image lives under{" "}
            <MenuLink screen="images" section="prompts">
              Prompt Templates
            </MenuLink>
            , with the rest of the wording.
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

function PromptsSection() {
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

/**
 * Delete stored art wholesale — the two kinds separately, because they go stale
 * for different reasons. Location art is the bulk (a banner per place visited,
 * each with a master behind it) and is the thing to throw away to reclaim space;
 * portraits are the thing to throw away after changing template, checkpoint or
 * style, so the cast is redrawn in the new one.
 *
 * Not gated on the master switch: purging is exactly what a player does when
 * they have just switched generation off.
 */
function StorageSection() {
  const purge = useStore((s) => s.purgeImages);
  const syncing = useStore((s) => s.settings.syncEnabled && s.account !== null);
  const [busy, setBusy] = useState<ImageKind | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  function describe(r: PurgeSummary): string {
    const parts = [`Deleted ${r.local} on this device`];
    if (syncing) parts.push(`${r.remote} in the cloud`);
    let line = parts.join(" · ") + ".";
    if (r.failed) line += ` ${r.failed} cloud ${r.failed === 1 ? "copy" : "copies"} refused — the next sync retries.`;
    if (r.error) line += ` The cloud could not be reached: ${r.error}`;
    return line;
  }

  function run(kind: ImageKind) {
    setResult(null);
    setBusy(kind);
    void purge(kind)
      .then((r) => setResult(describe(r)))
      .finally(() => setBusy(null));
  }

  const cloudLine = syncing
    ? " They go from the cloud too, so they don't come back on the next sync."
    : "";

  return (
    <section className="space-y-3 border-2 border-ink p-3">
      <h2 className="uppercase tracking-widest">Purge Stored Images</h2>
      <p className="text-sm">
        Delete generated art from the app's storage — the picture and the full-size
        master kept behind it for edits.
        {syncing
          ? " Both this device and the cloud."
          : " This device only; sign in under Cloud Saves to clear the cloud copies too."}
      </p>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          ask(
            {
              title: "Purge location images?",
              body:
                "Every location image and its master copy is deleted." +
                cloudLine +
                " A place is drawn again the next time you're there — the current location on your next turn, subject to the cooldown.",
              confirmLabel: "Purge",
            },
            () => run("banner"),
          )
        }
        className={btnSmall}
      >
        {busy === "banner" ? "Purging…" : "Purge Location Images"}
      </button>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          ask(
            {
              title: "Purge character images?",
              body:
                "Every portrait and its master copy is deleted, uploaded art included." +
                cloudLine +
                " The player character and the party are drawn again on your next turn; everyone else when their sheet is opened. Characters you removed a picture from stay without one.",
              confirmLabel: "Purge",
            },
            () => run("portrait"),
          )
        }
        className={btnSmall}
      >
        {busy === "portrait" ? "Purging…" : "Purge Character Images"}
      </button>

      {result && <p className="text-xs opacity-70">{result}</p>}
      {dialog}
    </section>
  );
}

const SECTIONS: SubMenuSection[] = [
  {
    id: "model",
    label: "Model",
    note: "Which machine draws · key · checkpoint",
    Body: ModelSection,
  },
  {
    id: "location",
    label: "Location Images",
    note: "The top bar's art · size · cooldown",
    Body: LocationSection,
  },
  {
    id: "prompts",
    label: "Prompt Templates",
    note: "Wording · banner · portraits · references",
    Body: PromptsSection,
  },
  {
    id: "storage",
    label: "Stored Images",
    note: "Purge location and character art",
    Body: StorageSection,
  },
];

/**
 * The two settings that apply to every image, wherever it came from, so they sit
 * above the sub-menus rather than inside one of them. Uploaded art goes through
 * the same 1-bit pass, which is why shading stays visible with generation off.
 */
function ImagesHeader() {
  const imagesEnabled = useStore((s) => s.settings.imagesEnabled);
  const ditherMode = useStore((s) => s.settings.ditherMode);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <ToggleRow
        label="Image Generation"
        state={imagesEnabled ? "ON" : "OFF"}
        onClick={() => update({ imagesEnabled: !imagesEnabled })}
      />

      {!imagesEnabled && (
        <p className="border-2 border-ink p-3 text-sm opacity-70">
          Off: nothing is sent to an image model — no portraits are drawn, no location
          images, and the regenerate and edit buttons are hidden. Pictures you already
          have still show, and you can still upload your own art on a character's sheet.
          Nothing is deleted; switching this back on picks up where you left off.
        </p>
      )}

      <SegmentedRow
        label="1-Bit Shading"
        value={ditherMode}
        options={DITHER_MODES}
        onChange={(v) => update({ ditherMode: v })}
        note={<p className="text-xs opacity-70">{DITHER_NOTES[ditherMode]}</p>}
      />
    </>
  );
}

export function ImagesScreen() {
  return <SubMenuScreen title="Images" sections={SECTIONS} header={<ImagesHeader />} />;
}
