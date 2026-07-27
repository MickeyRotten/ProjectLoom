import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, Section, ToggleRow, btnSmall } from "./fields";
import { DEFAULT_RISK_KEYWORDS, DEFAULT_STAKES_RULE } from "../lib/defaults";
import {
  DEFAULT_DICE,
  MAX_DICE_COUNT,
  MAX_DICE_SIDES,
  MAX_MODIFIER,
  bandScale,
  diceNotation,
  diceRange,
  normalizeDice,
} from "../lib/stakes";
import type { DiceRules } from "../types";

/**
 * RPG System (Menu → RPG System) — the dice, and everything about them.
 *
 * Stakes shipped as a single ON/OFF in Advanced → Narrator with one d6, ±1 for
 * Strengths/Flaws, and 5+/3–4/2− bands welded into `stakes.ts`. That is *a*
 * system, not *the* system, and it was the one part of the app the player
 * couldn't touch. Everything that decides a result lives here now: how many dice
 * and of what size, what Strengths and Flaws are worth, where the bands sit,
 * what counts as a gamble at all, and what the three results mean in this world.
 *
 * Its own screen rather than another Advanced sub-menu: Advanced is *prompt*
 * text — words handed to a model — and this is mechanics the app resolves
 * on-device before the model ever sees the turn.
 *
 * Values are clamped to their own range as they're typed, but the fields are
 * NOT coupled to each other here: `stakes.ts → normalizeDice` reconciles them at
 * roll time (a MIXED threshold above STRONG folds down), so editing one number
 * can never quietly rewrite the one below it mid-keystroke. The live preview
 * reads through the same function, so what it shows is what will be rolled.
 */

/** One clamped integer setting, in the 1-bit form system. */
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
    <Field label={label}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          // A cleared box reports NaN — keep the last good value rather than
          // writing a number nothing can roll.
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
      />
      {hint && <p className="text-xs opacity-70">{hint}</p>}
    </Field>
  );
}

/** The system as one line: what gets rolled, and what each total means. */
function SystemPreview({ rules }: { rules: DiceRules }) {
  const effective = normalizeDice(rules);
  const { min, max } = diceRange(effective);
  return (
    <p className="border-2 border-ink p-3 text-sm">
      Rolling <b>{diceNotation(effective)}</b> — totals {min}–{max}, before modifiers.
      <br />
      Bands: {bandScale(effective)}.
    </p>
  );
}

export function RpgSystemScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const testRoll = useStore((s) => s.testRoll);
  const { stakesEnabled, alwaysRoll, riskKeywords, stakesRule } = settings;

  // The widest a threshold can meaningfully sit: an unreachable STRONG makes
  // every gamble a disaster, which reads as a bug rather than a house rule.
  const rolled = normalizeDice(settings);
  const maxTotal = rolled.diceCount * rolled.diceSides + rolled.strengthsBonus;
  const minTotal = rolled.diceCount - rolled.flawsPenalty;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="RPG System" />
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <ToggleRow
          label="Stakes"
          state={stakesEnabled ? "ON" : "OFF"}
          onClick={() => update({ stakesEnabled: !stakesEnabled })}
        />

        {!stakesEnabled ? (
          <p className="border-2 border-ink p-3 text-sm opacity-70">
            Off: nothing is rolled, and the narrator decides how every action goes.
            Turn it on to resolve risky actions with dice the narrator has to honour.
          </p>
        ) : (
          <>
            <p className="border-2 border-ink p-3 text-sm">
              When you try something that can go wrong — a fight, a climb, a lie, a
              haggle — the app rolls here on the device, adjusts the total for your
              Strengths and Flaws, and tells the narrator which of the three results
              below it has to write. The narrator never picks the outcome. The roll is
              fixed for that action on that turn, so regenerating re-tells the same
              result rather than fishing for a better one — change the action to change
              the odds.
            </p>

            <SystemPreview rules={settings} />

            <Section label="Dice" />
            <NumberField
              label="Dice Per Roll"
              value={settings.diceCount}
              min={1}
              max={MAX_DICE_COUNT}
              onChange={(diceCount) => update({ diceCount })}
              hint="More dice cluster results in the middle — 2d6 goes wild far less often than 1d12."
            />
            <NumberField
              label="Sides Per Die"
              value={settings.diceSides}
              min={2}
              max={MAX_DICE_SIDES}
              onChange={(diceSides) => update({ diceSides })}
              hint="6 for the shipped system, 20 for a d20 table, 100 for percentile."
            />

            <Section label="Strengths & Flaws" />
            <NumberField
              label="Strengths Bonus"
              value={settings.strengthsBonus}
              min={0}
              max={MAX_MODIFIER}
              onChange={(strengthsBonus) => update({ strengthsBonus })}
              hint="Added when the attempt plays to the acting character's Strengths. 0 turns Strengths off mechanically."
            />
            <NumberField
              label="Flaws Penalty"
              value={settings.flawsPenalty}
              min={0}
              max={MAX_MODIFIER}
              onChange={(flawsPenalty) => update({ flawsPenalty })}
              hint="Taken off when it plays to their Flaws. An action touching both gets both."
            />

            <Section label="Outcome Bands" />
            <NumberField
              label="Strong From"
              value={settings.strongThreshold}
              min={minTotal}
              max={maxTotal}
              onChange={(strongThreshold) => update({ strongThreshold })}
              hint="Totals at or above this are a clean win. Raise it to make wins rare."
            />
            <NumberField
              label="Mixed From"
              value={settings.mixedThreshold}
              min={minTotal}
              max={maxTotal}
              onChange={(mixedThreshold) => update({ mixedThreshold })}
              hint="Totals at or above this — but under Strong — succeed at a price. Everything below costs you. Set it equal to Strong for a pass/fail table with no middle."
            />

            <Section label="When To Roll" />
            <ToggleRow
              label="Roll Every Turn"
              state={alwaysRoll ? "ON" : "OFF"}
              onClick={() => update({ alwaysRoll: !alwaysRoll })}
            />
            {alwaysRoll ? (
              <p className="border-2 border-ink p-3 text-sm opacity-70">
                Every turn is a check — even looking around the room. The words below
                are ignored while this is on.
              </p>
            ) : (
              <Field label="Risky Actions">
                <textarea
                  value={riskKeywords}
                  rows={6}
                  onChange={(e) => update({ riskKeywords: e.target.value })}
                  className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
                />
                <p className="text-xs opacity-70">
                  The words that make an action a gamble, separated by commas or
                  newlines. Matched whole — "break" does not fire on "breakfast" — and
                  every form you want has to be listed ("climb, climbs"). Anything not
                  on this list rolls nothing at all.
                </p>
                <button
                  type="button"
                  onClick={() => update({ riskKeywords: DEFAULT_RISK_KEYWORDS })}
                  disabled={riskKeywords === DEFAULT_RISK_KEYWORDS}
                  className={`mt-1 ${btnSmall}`}
                >
                  Reset to default
                </button>
              </Field>
            )}

            <Section label="Presentation" />
            <ToggleRow
              label="Dice Animation"
              state={settings.diceAnimation ? "ON" : "OFF"}
              onClick={() => update({ diceAnimation: !settings.diceAnimation })}
            />
            <p className="border-2 border-ink p-3 text-sm opacity-70">
              {settings.diceAnimation
                ? "The dice are thrown across the screen while the turn is being written — tap to skip. The result is the same either way; it is already decided before they land."
                : "Off: no toss. The roll still happens, and still shows on the beat as a chip."}
            </p>
            <button type="button" onClick={testRoll} className={`w-full ${btnSmall}`}>
              Test Roll
            </button>
            <p className="text-xs opacity-70">
              Throws the dice above with nothing at stake — no turn, no story, nothing
              recorded. Strengths and Flaws sit it out, so what you see is the system
              itself. Plays even with the animation off, since watching it is how you
              decide.
            </p>

            <Section label="Results" />
            <Field label="Outcome Rule">
              <textarea
                value={stakesRule}
                rows={8}
                onChange={(e) => update({ stakesRule: e.target.value })}
                className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
              />
              <p className="text-xs opacity-70">
                What a strong, mixed, or costly result means in your world. The dice are
                the mechanic; this is what the narrator does with the answer.
              </p>
              <button
                type="button"
                onClick={() => update({ stakesRule: DEFAULT_STAKES_RULE })}
                disabled={stakesRule === DEFAULT_STAKES_RULE}
                className={`mt-1 ${btnSmall}`}
              >
                Reset to default
              </button>
            </Field>

            <button
              type="button"
              onClick={() => update({ ...DEFAULT_DICE })}
              className={`w-full ${btnSmall}`}
            >
              Reset dice to 1d6 (5+ / 3–4 / 2−)
            </button>
          </>
        )}
      </div>
    </main>
  );
}
