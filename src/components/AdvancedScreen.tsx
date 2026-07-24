import { useRef } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, btnSmall } from "./fields";
import type { Settings } from "../types";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_OPTION_INSTRUCTIONS,
  DEFAULT_BANNER_INSTRUCTIONS,
  DEFAULT_PORTRAIT_ACTION,
  DEFAULT_PORTRAIT_CONTEXT,
  DEFAULT_PORTRAIT_COMPOSITION,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_REFERENCE_INSTRUCTION,
  DEFAULT_SPOTLIGHT_RULE,
} from "../lib/defaults";
import { blobToRefImage, MAX_REF_IMAGES, refImageToDataUrl } from "../lib/images";

/**
 * Advanced instructions (DESIGN.md → Menu): the player-editable prompt guidance
 * that steers the narrator, the option generator, the spotlight, and the image
 * models. Each field has a Reset to restore its ship default.
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
  | "spotlightRule"
  | "bannerInstructions"
  | "portraitAction"
  | "portraitContext"
  | "portraitComposition"
  | "portraitStyle"
>;

const FIELDS: { key: InstrKey; label: string; def: string; rows: number }[] = [
  { key: "customInstructions", label: "Narrator Instructions", def: DEFAULT_CUSTOM_INSTRUCTIONS, rows: 6 },
  { key: "optionInstructions", label: "Action Options", def: DEFAULT_OPTION_INSTRUCTIONS, rows: 3 },
  { key: "spotlightRule", label: "Spotlight Rule", def: DEFAULT_SPOTLIGHT_RULE, rows: 4 },
  { key: "bannerInstructions", label: "Banner Style", def: DEFAULT_BANNER_INSTRUCTIONS, rows: 3 },
  { key: "portraitAction", label: "Portrait Action", def: DEFAULT_PORTRAIT_ACTION, rows: 2 },
  { key: "portraitContext", label: "Portrait Location/Context", def: DEFAULT_PORTRAIT_CONTEXT, rows: 2 },
  { key: "portraitComposition", label: "Portrait Composition", def: DEFAULT_PORTRAIT_COMPOSITION, rows: 2 },
  { key: "portraitStyle", label: "Portrait Style", def: DEFAULT_PORTRAIT_STYLE, rows: 3 },
];

export function AdvancedScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const fileInput = useRef<HTMLInputElement>(null);

  const refs = settings.portraitRefImages;

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
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Advanced" />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => update({ showActionOptions: !settings.showActionOptions })}
          className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>AI Suggested Actions</span>
          <span className="border-2 border-ink px-2 py-1 text-sm">
            {settings.showActionOptions ? "ON" : "OFF"}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            update({ ditherMode: settings.ditherMode === "bayer4" ? "threshold" : "bayer4" })
          }
          className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>1-Bit Shading</span>
          <span className="border-2 border-ink px-2 py-1 text-sm">
            {settings.ditherMode === "bayer4" ? "DITHER" : "THRESHOLD"}
          </span>
        </button>

        {FIELDS.filter(
          (f) => f.key !== "optionInstructions" || settings.showActionOptions,
        ).map((f) => (
          <Field key={f.key} label={f.label}>
            <textarea
              value={settings[f.key]}
              rows={f.rows}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => update({ [f.key]: f.def })}
              disabled={settings[f.key] === f.def}
              className={`mt-1 ${btnSmall}`}
            >
              Reset to default
            </button>
          </Field>
        ))}

        <section className="space-y-3 border-2 border-ink p-3">
          <h2 className="uppercase tracking-widest">Portrait Style References</h2>
          <p className="text-sm">
            These images teach the art style used for all character portraits.
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

          <Field label="Reference Instruction">
            <textarea
              value={settings.portraitRefInstruction}
              rows={3}
              onChange={(e) => update({ portraitRefInstruction: e.target.value })}
              className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => update({ portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION })}
              disabled={settings.portraitRefInstruction === DEFAULT_REFERENCE_INSTRUCTION}
              className={`mt-1 ${btnSmall}`}
            >
              Reset to default
            </button>
          </Field>
        </section>
      </div>
    </main>
  );
}
