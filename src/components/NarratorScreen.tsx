import { useStore } from "../store";
import { SubMenuScreen, type SubMenuSection } from "./SubMenuScreen";
import { Field, SegmentedRow, ToggleRow, btnSmall } from "./fields";
import { KeyField } from "./KeyField";
import { ModelPicker } from "./ModelPicker";
import { splitModels, useModelCatalog } from "./useModelCatalog";
import { REASONING_LEVELS, type ReasoningLevel, type Settings } from "../types";
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
 * Everything that steers the TEXT model, in one place (DESIGN.md → Menu): the
 * model it runs on, the voice it writes in, what it is allowed to remember, and
 * the rules it writes your cast by.
 *
 * Replaces the text half of the old *Model & Key* screen and two of *Advanced*'s
 * four sub-menus. The join is the point: reasoning effort and the beat length
 * cap are billed against each other, and the old screens were far enough apart
 * that one of them had to explain the other in prose ("counts against Advanced →
 * Narrator → Beat Length Limit"). They now sit in the same list.
 *
 * The JSON *shape* the narrator emits is the parser's contract and is never
 * editable here — see `loom-turn-protocol`.
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

const NARRATOR_FIELD: InstrSpec = {
  key: "customInstructions",
  label: "Narrator Instructions",
  def: DEFAULT_CUSTOM_INSTRUCTIONS,
  rows: 8,
  hint: "The narrator's craft — voice, pacing, tone. Setting and genre come from the Scenario.",
};

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
 * character meets it: how they're born, what stays frozen afterwards, where they
 * sit, how they leave, and when they speak.
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
 * Labels for the reasoning picker. Short enough for three-across on a phone;
 * "AUTO" is deliberately not called "default", because it means "send nothing
 * and let the model decide", not "our recommended level".
 */
const REASONING_LABELS: Record<ReasoningLevel, string> = {
  auto: "Auto",
  off: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
};

/** One line under the picker explaining the level that is actually selected. */
const REASONING_NOTES: Record<ReasoningLevel, string> = {
  auto: "Nothing is asked for — the model thinks however it normally would.",
  off: "Thinking is switched off where the model allows it. Cheaper and faster; models that always think ignore this.",
  minimal: "The shortest think the model offers before it writes.",
  low: "A little thinking. Slower and dearer than off, steadier on tangled turns.",
  medium: "A balanced think on every turn — noticeably slower and dearer.",
  high: "The longest think the model offers. Slow, and the most expensive way to play.",
};

const REASONING_OPTIONS = REASONING_LEVELS.map((level) => ({
  value: level,
  label: REASONING_LABELS[level],
}));

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

/**
 * The credentials and the request knobs — the OpenRouter key, which model runs
 * the narration and the side calls, and the three parameters that decide what
 * one call costs.
 *
 * The catalog is fetched from OpenRouter on open so the model is chosen from a
 * filterable list; on a fetch failure the field falls back to a free-text id.
 * Shares `KeyField` and `ModelPicker` with the first-run Setup screen, so the
 * two can never drift on what a key check or a model list looks like.
 */
function ModelSection() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const { models, loading, error } = useModelCatalog();
  const { text } = splitModels(models);

  return (
    <>
      <KeyField
        label="OpenRouter API Key"
        value={settings.openRouterKey}
        onChange={(v) => update({ openRouterKey: v })}
        showSignupLink
      />

      <ModelPicker
        label="Text Model"
        value={settings.textModelId}
        onChange={(v) => update({ textModelId: v })}
        models={text}
        loading={loading}
        error={error}
      />

      <SegmentedRow
        label="Reasoning"
        value={settings.reasoningLevel}
        options={REASONING_OPTIONS}
        onChange={(v) => update({ reasoningLevel: v })}
        note={
          <>
            <p className="text-xs opacity-70">{REASONING_NOTES[settings.reasoningLevel]}</p>
            <p className="text-xs opacity-70">
              How hard the text model thinks before it writes. Only reasoning models do
              anything with this. Thinking is billed like any other output and counts
              against the Beat Length Limit below, so a tight cap plus a high level can
              cut a beat off mid-write.
            </p>
          </>
        }
      />

      <Field label={`Temperature — ${settings.temperature.toFixed(2)}`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={settings.temperature}
          onChange={(e) => update({ temperature: Number(e.target.value) })}
          className="w-full accent-ink"
        />
      </Field>

      <Field label="Beat Length Limit">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_BEAT_TOKENS}
          step={100}
          value={settings.maxTokens}
          onChange={(e) => update({ maxTokens: clampMaxTokens(e.target.valueAsNumber) })}
          className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
        />
        <p className="text-xs opacity-70">
          Hard cap on one beat, in tokens. 0 removes the cap and lets the model run as
          long as it likes. Too low and the machine block at the end of a beat gets cut
          off mid-write.
        </p>
      </Field>
    </>
  );
}

/** How a beat is written, and whether the narrator suggests what to do next. */
function VoiceSection() {
  const showActionOptions = useStore((s) => s.settings.showActionOptions);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <InstrField spec={NARRATOR_FIELD} />
      <ToggleRow
        label="AI Suggested Actions"
        state={showActionOptions ? "ON" : "OFF"}
        onClick={() => update({ showActionOptions: !showActionOptions })}
      />
      {showActionOptions && <InstrField spec={OPTION_FIELD} />}
    </>
  );
}

/**
 * What the narrator is shown of the past. The rolling history window and the
 * journal sit together on purpose: they compete for the same context, and the
 * trade only makes sense read together — past a certain age it favours the
 * journal, since a summarised day is far denser than the raw beats it replaces
 * and those beats were being evicted anyway.
 */
function MemorySection() {
  const historyBudget = useStore((s) => s.settings.historyBudget);
  const journalEnabled = useStore((s) => s.settings.journalEnabled);
  const journalBudget = useStore((s) => s.settings.journalBudget);
  const journalMaxTurns = useStore((s) => s.settings.journalMaxTurns);
  const journalMinTurns = useStore((s) => s.settings.journalMinTurns);
  const update = useStore((s) => s.updateSettings);
  return (
    <>
      <Field label="Memory — Story">
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

      <ToggleRow
        label="Journal"
        state={journalEnabled ? "ON" : "OFF"}
        onClick={() => update({ journalEnabled: !journalEnabled })}
      />

      {journalEnabled && (
        <>
          <Field label="Memory — Journal">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_JOURNAL_BUDGET}
              step={100}
              value={journalBudget}
              onChange={(e) => update({ journalBudget: clampJournalBudget(e.target.valueAsNumber) })}
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

/** The rules the story writes your cast by — not the cast itself (Menu → Characters). */
function WritingCharactersSection() {
  return (
    <>
      <p className="border-2 border-ink p-3 text-sm">
        A character's sheet is written once, when the story first introduces them, and
        is frozen after that: the narrator can move them between standings, but their
        appearance, personality, drive, strengths, flaws and equipment stay yours. Use the member sheet's
        Auto-Update to re-read a sheet from the story on purpose.
      </p>
      <p className="text-xs opacity-70">
        How an appearance is written lives under Images → Prompt Templates — it becomes
        the character's portrait prompt verbatim, so it belongs with the rest of the
        image wording.
      </p>
      {CHARACTER_FIELDS.map((f) => (
        <InstrField key={f.key} spec={f} />
      ))}
    </>
  );
}

const SECTIONS: SubMenuSection[] = [
  {
    id: "model",
    label: "Model",
    note: "API key · text model · reasoning · length",
    Body: ModelSection,
  },
  {
    id: "voice",
    label: "Voice & Actions",
    note: "How a beat is written · suggested actions",
    Body: VoiceSection,
  },
  {
    id: "memory",
    label: "Memory",
    note: "How much of the past the narrator is shown · journal",
    Body: MemorySection,
  },
  {
    id: "characters",
    label: "Writing Characters",
    note: "Creation · the freeze rule · standings · spotlight",
    Body: WritingCharactersSection,
  },
];

export function NarratorScreen() {
  return <SubMenuScreen title="Narrator" sections={SECTIONS} />;
}
