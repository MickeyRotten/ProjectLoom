import { useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, TextField, AreaField } from "./fields";
import { GenerateModal } from "./GenerateModal";
import { SCENARIO_FIELD_LABEL, type ScenarioField } from "../lib/generateScenario";

/**
 * Scenario editor (DESIGN.md → Menu). The pre-made scenario is fully editable
 * in place — title, premise, opening narration, and the start day the next
 * New Adventure seeds from. Edits mutate the active game immediately.
 *
 * Premise and Opening Narration each carry a ✦ generate button, the same one
 * the member sheet's prose fields have (`generateScenario.ts`). Unlike the sheet
 * there is no Edit gate here — this screen writes as you type — so an accepted
 * generation is committed straight away, which the modal says before it lands.
 */
export function ScenarioScreen() {
  const scenario = useStore((s) => s.game.scenario);
  const update = useStore((s) => s.updateScenario);
  const generate = useStore((s) => s.generateScenarioField);
  const [genField, setGenField] = useState<ScenarioField | null>(null);

  const genButton = (field: ScenarioField) => (
    <button
      type="button"
      aria-label={`Generate ${SCENARIO_FIELD_LABEL[field]}`}
      onClick={() => setGenField(field)}
      className="border-2 border-ink px-2 py-1 leading-none active:bg-ink active:text-paper"
    >
      ✦
    </button>
  );

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Scenario" />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <TextField label="Title" value={scenario.title} onChange={(v) => update({ title: v })} />
        <TextField
          label="Starting Location"
          value={scenario.startLocation ?? ""}
          onChange={(v) => update({ startLocation: v })}
          placeholder="Where the adventure opens"
        />
        <AreaField
          label="Premise"
          value={scenario.premise}
          rows={4}
          action={genButton("premise")}
          onChange={(v) => update({ premise: v })}
        />
        <AreaField
          label="Opening Narration"
          value={scenario.openingNarration}
          rows={4}
          action={genButton("openingNarration")}
          onChange={(v) => update({ openingNarration: v })}
        />
        <Field label="Start Day">
          <input
            type="number"
            min={0}
            value={scenario.startDay}
            onChange={(e) => update({ startDay: Math.max(0, Number(e.target.value) || 0) })}
            className="w-24 border-2 border-ink bg-paper p-2 text-center tabular-nums focus:outline-none"
          />
        </Field>
        <p className="text-sm opacity-60">
          Title · premise · opening seed the next New Adventure. Editing here changes the active
          game too.
        </p>
      </div>

      {genField && (
        <GenerateModal
          label={SCENARIO_FIELD_LABEL[genField]}
          blurb={
            genField === "premise"
              ? "The model writes the setting from the title, the opening narration, your player character and any world notes they touch."
              : "The model writes the first beat from the premise, the starting location and your player character — second person, exactly as a turn is written."
          }
          replacing={!!scenario[genField].trim()}
          replacingNote={`Replaces the ${SCENARIO_FIELD_LABEL[genField]} immediately — this screen has no Edit gate. Copy the old text first if you want it back.`}
          run={(hint) => generate(genField, hint)}
          onAccept={(text) => update({ [genField]: text })}
          onClose={() => setGenField(null)}
        />
      )}
    </main>
  );
}
