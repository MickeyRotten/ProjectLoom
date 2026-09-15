import { useStore } from "../store";
import { MenuLink } from "./SubMenuScreen";
import {
  MaterialHeader,
  fieldLabel,
  filledInput,
  filledTextarea,
  notice,
  pillOutline,
  pillSolid,
  sectionHeading,
} from "./material";
import { DEFAULT_STAKES_RULE } from "../lib/defaults";
import {
  ATTRIBUTE_LABELS,
  DEFAULT_ATTRIBUTE_RULES,
  MAX_MARGIN_PCT,
  MAX_MARGIN_POINTS,
  MAX_POINT_VALUE,
  bandScale,
  defaultSpecialisations,
  newSpecialisation,
} from "../lib/attributes";
import { defaultGMMoves, newGMMove } from "../lib/gmMoves";
import { ATTRIBUTES } from "../types";
import type { Attribute, AttributeRules, GMMove, Specialisation } from "../types";

/**
 * RPG System (Menu → RPG System) — Attributes, Specialisations, GM Moves and
 * the percentile roll they feed (RPG_DESIGN.md). Replaces the shipped
 * 1d6/`DiceRules` screen: instead of dice, Strengths/Flaws and a keyword risk
 * gate, a risky action now checks a percentile roll against a Target Number
 * built from the acting character's build, decided by a separate cold
 * classifier call (`intent.ts`) rather than a word list. The roll stays
 * hidden until it lands — no toss, no animation — because the point is a
 * check the narrator cannot see coming, not a spectacle.
 */

/** One clamped integer setting, in the Material filled-input form. */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className={filledInput}
      />
      {hint && <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">{hint}</p>}
    </div>
  );
}

/** The system as one line: the worked example at the shipped rules' own numbers. */
function SystemPreview({ rules }: { rules: AttributeRules }) {
  const example = Math.min(rules.maxChance, Math.max(rules.minChance, rules.baseChance));
  return (
    <p className={notice}>
      A character with nothing going for them checks at a flat <b>{rules.baseChance}%</b>. Each
      Attribute point moves it <b>{rules.attributePoint >= 0 ? "+" : ""}
      {rules.attributePoint}%</b>, a matched Specialisation adds <b>+{rules.specialisationBonus}%</b>,
      clamped to <b>{rules.minChance}–{rules.maxChance}%</b>.
      <br />
      At {example}%: {bandScale(example, rules)}.
    </p>
  );
}

function SpecialisationRow({
  spec,
  onChange,
  onRemove,
}: {
  spec: Specialisation;
  onChange: (next: Specialisation) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={spec.label}
        placeholder="Label"
        onChange={(e) => onChange({ ...spec, label: e.target.value })}
        className={`flex-1 ${filledInput}`}
      />
      <select
        aria-label="Attribute"
        value={spec.attribute}
        onChange={(e) => onChange({ ...spec, attribute: e.target.value as Attribute })}
        className="rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-[11px] text-[13px] text-ink outline-none"
      >
        {ATTRIBUTES.map((a) => (
          <option key={a} value={a}>
            {ATTRIBUTE_LABELS[a]}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Remove ${spec.label || "specialisation"}`}
        onClick={onRemove}
        className={`${pillOutline} !min-h-9 !px-3`}
      >
        ✕
      </button>
    </div>
  );
}

function GMMoveRow({
  move,
  onChange,
  onRemove,
}: {
  move: GMMove;
  onChange: (next: GMMove) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1.5 rounded-[10px] bg-[var(--m-surface-strong)] p-3">
      <div className="flex items-center gap-2">
        <input
          value={move.label}
          placeholder="Move"
          onChange={(e) => onChange({ ...move, label: e.target.value })}
          className={`flex-1 ${filledInput}`}
        />
        <button
          type="button"
          aria-label={`Remove ${move.label || "move"}`}
          onClick={onRemove}
          className={`${pillOutline} !min-h-9 !px-3`}
        >
          ✕
        </button>
      </div>
      <textarea
        value={move.description}
        placeholder="What it does"
        rows={2}
        onChange={(e) => onChange({ ...move, description: e.target.value })}
        className={filledTextarea}
      />
    </div>
  );
}

export function RpgSystemScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const stakesEnabled = settings.features.stakes;
  const rules = settings.attributeRules;
  const { stakesRule, specialisations, gmMoves } = settings;

  const updateRules = (patch: Partial<AttributeRules>) =>
    update({ attributeRules: { ...rules, ...patch } });

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="RPG System" back />
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        {!stakesEnabled ? (
          <p className={notice}>
            Off: nothing is rolled, and the narrator decides how every action goes. Turn on
            Outcome Rolls under <MenuLink screen="features">Features</MenuLink> to resolve risky
            actions with a check the narrator has to honour.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
              When you try something that can go wrong, a separate cold check first decides
              whether it's a gamble at all and which of your build it plays to — never the
              narrator's own call. If it is, the app rolls a hidden percentile check on-device
              against a chance built from your Attributes, Specialisations and gear, and tells the
              narrator which of the three results below it has to write. The roll is fixed for
              that action on that turn, so regenerating re-tells the same result rather than
              fishing for a better one.
            </p>

            <p className={sectionHeading}>Attributes & Specialisations</p>
            <SystemPreview rules={rules} />
            <NumberField
              label="Base Chance"
              value={rules.baseChance}
              min={0}
              max={100}
              onChange={(baseChance) => updateRules({ baseChance })}
              hint="Flat starting chance before anything else applies."
            />
            <NumberField
              label="Percent Per Attribute Point"
              value={rules.attributePoint}
              min={-MAX_POINT_VALUE}
              max={MAX_POINT_VALUE}
              onChange={(attributePoint) => updateRules({ attributePoint })}
              hint="Added per point of the acting Attribute — a −1 subtracts."
            />
            <NumberField
              label="Specialisation Bonus"
              value={rules.specialisationBonus}
              min={0}
              max={MAX_POINT_VALUE}
              onChange={(specialisationBonus) => updateRules({ specialisationBonus })}
              hint="Flat percent added when the check matches a held Specialisation."
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Minimum Chance"
                value={rules.minChance}
                min={1}
                max={99}
                onChange={(minChance) => updateRules({ minChance })}
              />
              <NumberField
                label="Maximum Chance"
                value={rules.maxChance}
                min={rules.minChance}
                max={99}
                onChange={(maxChance) => updateRules({ maxChance })}
              />
            </div>
            <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
              A check never falls outside this range — a hopeless build keeps a sliver of luck,
              and a maxed-out one can still fail.
            </p>
            <NumberField
              label="Mixed Band Width"
              value={rules.mixedMarginPct}
              min={0}
              max={MAX_MARGIN_PCT}
              onChange={(mixedMarginPct) => updateRules({ mixedMarginPct })}
              hint="Percent of the Target Number that reads as MIXED instead of a clean Great."
            />
            <NumberField
              label="Minimum Mixed Width"
              value={rules.minMargin}
              min={0}
              max={MAX_MARGIN_POINTS}
              onChange={(minMargin) => updateRules({ minMargin })}
              hint="The MIXED band never shrinks below this many points, even on a low chance."
            />
            <button
              type="button"
              onClick={() => update({ attributeRules: DEFAULT_ATTRIBUTE_RULES })}
              className={`w-full ${pillOutline}`}
            >
              Reset roll math to defaults
            </button>

            <p className={sectionHeading}>Specialisation Catalog</p>
            <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
              What specialisations exist in this game. A character's own held set is picked on
              their sheet.
            </p>
            <div className="space-y-2">
              {specialisations.map((s, i) => (
                <SpecialisationRow
                  key={s.id}
                  spec={s}
                  onChange={(next) =>
                    update({ specialisations: specialisations.map((x, j) => (j === i ? next : x)) })
                  }
                  onRemove={() => update({ specialisations: specialisations.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => update({ specialisations: [...specialisations, newSpecialisation()] })}
                className={`flex-1 ${pillOutline}`}
              >
                + Specialisation
              </button>
              <button
                type="button"
                onClick={() => update({ specialisations: defaultSpecialisations() })}
                className={`flex-1 ${pillOutline}`}
              >
                Reset catalog
              </button>
            </div>

            <p className={sectionHeading}>GM Moves</p>
            <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
              What the narrator reaches for on a Fail, or when the player hesitates, instead of
              freelancing a consequence.
            </p>
            <div className="space-y-2">
              {gmMoves.map((m, i) => (
                <GMMoveRow
                  key={m.id}
                  move={m}
                  onChange={(next) => update({ gmMoves: gmMoves.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => update({ gmMoves: gmMoves.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => update({ gmMoves: [...gmMoves, newGMMove()] })}
                className={`flex-1 ${pillOutline}`}
              >
                + Move
              </button>
              <button
                type="button"
                onClick={() => update({ gmMoves: defaultGMMoves() })}
                className={`flex-1 ${pillOutline}`}
              >
                Reset moves
              </button>
            </div>

            <p className={sectionHeading}>Results</p>
            <div className="space-y-1.5">
              <span className={fieldLabel}>Outcome Rule</span>
              <textarea
                value={stakesRule}
                rows={8}
                onChange={(e) => update({ stakesRule: e.target.value })}
                className={filledTextarea}
              />
              <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
                What a great, mixed, or costly result means in your world. The roll is the
                mechanic; this is what the narrator does with the answer.
              </p>
              <button
                type="button"
                onClick={() => update({ stakesRule: DEFAULT_STAKES_RULE })}
                disabled={stakesRule === DEFAULT_STAKES_RULE}
                className={`${pillSolid} !min-h-9 !px-3.5`}
              >
                Reset to default
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
