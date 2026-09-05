import { useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, TextField, AreaField, btnSmall } from "./fields";
import { GenerateModal } from "./GenerateModal";
import {
  SCENARIO_FIELD_LABEL,
  SCENARIO_LIST_FIELDS,
  type ScenarioField,
  type SeedRowKind,
} from "../lib/generateScenario";
import type { Faction } from "../types";

/**
 * Scenario editor (DESIGN.md → World Seed). The pre-made scenario is fully
 * editable in place — title, the world seed (premise, tone, physical logic,
 * factions, threads, danger curve, fixed points), opening narration, and the
 * start day the next New Adventure seeds from. Edits mutate the active game
 * immediately.
 *
 * Every field beyond premise is short and optional by design (DESIGN.md →
 * World Seed): a field that grows past a screen's worth of text belongs on a
 * `Place` or a World Note instead. Every field here carries a ✦ generate
 * button, the same one the member sheet's prose fields have (`generateScenario.ts`).
 * Unlike the sheet there is no Edit gate here — this screen writes as you
 * type — so an accepted generation is committed straight away, which the
 * modal says before it lands.
 */
export function ScenarioScreen() {
  const scenario = useStore((s) => s.game.scenario);
  const update = useStore((s) => s.updateScenario);
  const generate = useStore((s) => s.generateScenarioField);
  const generateRow = useStore((s) => s.generateSeedRow);
  const [genField, setGenField] = useState<ScenarioField | null>(null);
  const [genRow, setGenRow] = useState<{ kind: SeedRowKind; index: number } | null>(null);

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

  const rowGenButton = (kind: SeedRowKind, index: number) => (
    <button
      type="button"
      aria-label={`Generate ${kind === "faction" ? "Faction" : "Fixed Point"}`}
      onClick={() => setGenRow({ kind, index })}
      className="border-2 border-ink px-2 py-1 leading-none active:bg-ink active:text-paper"
    >
      ✦
    </button>
  );

  const setFaction = (index: number, patch: Partial<Faction>) =>
    update({
      factions: scenario.factions.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });
  const setFixedPoint = (index: number, patch: Partial<Faction>) =>
    update({
      fixedPoints: scenario.fixedPoints.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });

  const rowsFor = (kind: SeedRowKind) => (kind === "faction" ? scenario.factions : scenario.fixedPoints);

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

        {(["tone", "physicalLogic", "dangerCurve"] as const).map((field) => (
          <AreaField
            key={field}
            label={`${SCENARIO_FIELD_LABEL[field]} (one per line)`}
            value={scenario[field].join("\n")}
            rows={3}
            action={genButton(field)}
            onChange={(v) => update({ [field]: splitLines(v) })}
          />
        ))}

        <RowList
          label="Factions"
          rows={scenario.factions}
          onAdd={() => update({ factions: [...scenario.factions, { name: "", description: "" }] })}
          onRemove={(i) => update({ factions: scenario.factions.filter((_, j) => j !== i) })}
          onChange={setFaction}
          genButton={(i) => rowGenButton("faction", i)}
        />

        <RowList
          label="Fixed Points"
          rows={scenario.fixedPoints}
          onAdd={() =>
            update({ fixedPoints: [...scenario.fixedPoints, { name: "", description: "" }] })
          }
          onRemove={(i) => update({ fixedPoints: scenario.fixedPoints.filter((_, j) => j !== i) })}
          onChange={setFixedPoint}
          genButton={(i) => rowGenButton("fixedPoint", i)}
        />

        <AreaField
          label="Open Threads (one per line)"
          value={scenario.threads.join("\n")}
          rows={3}
          placeholder="What happened to the missing captain?"
          onChange={(v) => update({ threads: splitLines(v) })}
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
          This is the world seed: the one small, always-read document that keeps the narrator
          consistent as it generates new areas, people and events. Editing here changes the
          active game too.
        </p>
      </div>

      {genField && !SCENARIO_LIST_FIELDS.includes(genField) && (
        <GenerateModal
          label={SCENARIO_FIELD_LABEL[genField]}
          blurb="The model writes this field from the rest of the world seed, your player character and any world notes they touch."
          replacing={!!scenario[genField].toString().trim()}
          replacingNote={`Replaces the ${SCENARIO_FIELD_LABEL[genField]} immediately — this screen has no Edit gate. Copy the old text first if you want it back.`}
          run={(hint) => generate(genField, hint)}
          onAccept={(text) => update({ [genField as "premise" | "openingNarration"]: text })}
          onClose={() => setGenField(null)}
        />
      )}

      {genField && SCENARIO_LIST_FIELDS.includes(genField) && (
        <GenerateModal
          label={SCENARIO_FIELD_LABEL[genField]}
          blurb="The model writes a short list from the rest of the world seed, one line each."
          replacing={scenario[genField as "tone" | "physicalLogic" | "dangerCurve"].length > 0}
          replacingNote={`Replaces ${SCENARIO_FIELD_LABEL[genField]} immediately — this screen has no Edit gate.`}
          run={(hint) => generate(genField, hint)}
          onAccept={(text) =>
            update({ [genField as "tone" | "physicalLogic" | "dangerCurve"]: splitLines(text) })
          }
          onClose={() => setGenField(null)}
        />
      )}

      {genRow && (
        <GenerateModal<Faction>
          label={genRow.kind === "faction" ? "Faction" : "Fixed Point"}
          blurb="The model writes one entry from the rest of the world seed and what's already written."
          replacing={Boolean(rowsFor(genRow.kind)[genRow.index]?.name.trim())}
          replacingNote="Replaces this entry's name and description immediately — this screen has no Edit gate."
          run={(hint) =>
            generateRow(
              genRow.kind,
              rowsFor(genRow.kind).filter((_, i) => i !== genRow.index),
              hint,
            )
          }
          preview={(row) => (
            <>
              <span className="font-bold">{row.name}</span>
              {row.description && `\n${row.description}`}
            </>
          )}
          onAccept={(row) =>
            genRow.kind === "faction" ? setFaction(genRow.index, row) : setFixedPoint(genRow.index, row)
          }
          onClose={() => setGenRow(null)}
        />
      )}
    </main>
  );
}

function RowList({
  label,
  rows,
  onAdd,
  onRemove,
  onChange,
  genButton,
}: {
  label: string;
  rows: Faction[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<Faction>) => void;
  genButton: (index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="uppercase tracking-widest text-sm">{label}</p>
      {rows.length === 0 && <p className="text-sm opacity-60">None yet.</p>}
      {rows.map((row, i) => (
        <div key={i} className="space-y-2 border-2 border-ink p-2">
          <TextField
            label="Name"
            value={row.name}
            action={genButton(i)}
            onChange={(v) => onChange(i, { name: v })}
          />
          <TextField
            label="Description"
            value={row.description}
            onChange={(v) => onChange(i, { description: v })}
          />
          <button type="button" onClick={() => onRemove(i)} className={btnSmall}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd} className={`w-full ${btnSmall}`}>
        + Add {label.replace(/s$/, "")}
      </button>
    </div>
  );
}

const splitLines = (value: string): string[] =>
  value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
