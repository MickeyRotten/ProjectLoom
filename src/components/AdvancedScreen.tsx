import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, ToggleRow, btnSmall } from "./fields";
import type { Settings } from "../types";
import {
  DEFAULT_APPEARANCE_INSTRUCTIONS,
  DEFAULT_CHARACTER_CREATION_INSTRUCTIONS,
  DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_DEPARTURE_INSTRUCTIONS,
  DEFAULT_JOURNAL_INSTRUCTIONS,
  DEFAULT_OPTION_INSTRUCTIONS,
  DEFAULT_BANNER_INSTRUCTIONS,
  DEFAULT_PORTRAIT_ACTION,
  DEFAULT_PORTRAIT_CONTEXT,
  DEFAULT_PORTRAIT_COMPOSITION,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_REFERENCE_INSTRUCTION,
  DEFAULT_SPOTLIGHT_RULE,
  DEFAULT_STANDING_INSTRUCTIONS,
} from "../lib/defaults";
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
 * INDEX of sub-menus — Narrator · Characters · Images · Portraits — each opening
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
  | "appearanceInstructions"
  | "characterCreationInstructions"
  | "characterUpdateInstructions"
  | "standingInstructions"
  | "departureInstructions"
  | "bannerInstructions"
  | "portraitAction"
  | "portraitContext"
  | "portraitComposition"
  | "portraitStyle"
>;

interface InstrSpec {
  key: InstrKey;
  label: string;
  def: string;
  rows: number;
  /** One line under the field saying what this text actually steers. */
  hint?: string;
}

type SectionId = "narrator" | "characters" | "images" | "portraits";

const SECTIONS: { id: SectionId; label: string; note: string }[] = [
  { id: "narrator", label: "Narrator", note: "Voice · tone · suggested actions" },
  { id: "characters", label: "Characters", note: "How the story writes your cast" },
  { id: "images", label: "Images", note: "1-bit shading · location art" },
  { id: "portraits", label: "Portraits", note: "Portrait prompt · style references" },
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
    key: "appearanceInstructions",
    label: "Appearance Descriptions",
    def: DEFAULT_APPEARANCE_INSTRUCTIONS,
    rows: 3,
    hint: "The appearance text a new character is written with — it becomes their portrait prompt verbatim.",
  },
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

const BANNER_FIELD: InstrSpec = {
  key: "bannerInstructions",
  label: "Banner Style",
  def: DEFAULT_BANNER_INSTRUCTIONS,
  rows: 4,
  hint: "The art style for location images.",
};

const PORTRAIT_FIELDS: InstrSpec[] = [
  { key: "portraitAction", label: "Portrait Action", def: DEFAULT_PORTRAIT_ACTION, rows: 3 },
  {
    key: "portraitContext",
    label: "Portrait Location/Context",
    def: DEFAULT_PORTRAIT_CONTEXT,
    rows: 2,
  },
  {
    key: "portraitComposition",
    label: "Portrait Composition",
    def: DEFAULT_PORTRAIT_COMPOSITION,
    rows: 2,
  },
  { key: "portraitStyle", label: "Portrait Style", def: DEFAULT_PORTRAIT_STYLE, rows: 5 },
];

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

          <InstrField spec={BANNER_FIELD} />
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

function PortraitsSection() {
  const refs = useStore((s) => s.settings.portraitRefImages);
  const refInstruction = useStore((s) => s.settings.portraitRefInstruction);
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
    <>
      <GenerationOffNote />

      {PORTRAIT_FIELDS.map((f) => (
        <InstrField key={f.key} spec={f} />
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
            value={refInstruction}
            rows={3}
            onChange={(e) => update({ portraitRefInstruction: e.target.value })}
            className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={() => update({ portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION })}
            disabled={refInstruction === DEFAULT_REFERENCE_INSTRUCTION}
            className={`mt-1 ${btnSmall}`}
          >
            Reset to default
          </button>
        </Field>
      </section>
    </>
  );
}

const SECTION_BODY: Record<SectionId, () => React.ReactElement> = {
  narrator: NarratorSection,
  characters: CharactersSection,
  images: ImagesSection,
  portraits: PortraitsSection,
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
