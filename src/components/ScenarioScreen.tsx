import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, TextField, AreaField } from "./fields";

/**
 * Scenario editor (DESIGN.md → Menu). The pre-made scenario is fully editable
 * in place — title, premise, opening narration, and the start day the next
 * New Adventure seeds from. Edits mutate the active game immediately.
 */
export function ScenarioScreen() {
  const scenario = useStore((s) => s.game.scenario);
  const update = useStore((s) => s.updateScenario);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Scenario" onBack={() => setScreen("menu")} />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <TextField label="Title" value={scenario.title} onChange={(v) => update({ title: v })} />
        <AreaField
          label="Premise"
          value={scenario.premise}
          rows={4}
          onChange={(v) => update({ premise: v })}
        />
        <AreaField
          label="Opening Narration"
          value={scenario.openingNarration}
          rows={4}
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
    </main>
  );
}
