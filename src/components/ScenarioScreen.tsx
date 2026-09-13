import { useRef, useState } from "react";
import { useStore } from "../store";
import { GenerateModal } from "./GenerateModal";
import {
  MaterialHeader,
  card,
  fieldLabel,
  filledInput,
  filledTextarea,
  pillOutline,
} from "./material";
import { coverKey } from "../lib/images";
import {
  SCENARIO_FIELD_LABEL,
  SCENARIO_LIST_FIELDS,
  type ScenarioField,
  type SeedRowKind,
} from "../lib/generateScenario";
import type { Faction } from "../types";

/**
 * Scenario editor (DESIGN.md → World Seed) — Material redesign (`Loom
 * Material Redesign.dc.html`) for layout and controls; the real field set
 * (title, the full world seed, opening narration, start day) and its
 * always-editable behaviour are unchanged from before. The mock-up's simpler
 * 3-block sheet doesn't cover Factions/Fixed Points/Threads/Starting
 * Location — this keeps every one of them, restyled, rather than dropping
 * fields the mock never showed. There is deliberately no Edit gate here,
 * same as before: this screen writes as you type, unlike the sheet screens.
 *
 * A cover-art slot sits at the top, sharing the Play header's cover image
 * (`coverKey()`) — one adventure, one cover, shown in both places.
 */
export function ScenarioScreen() {
  const scenario = useStore((s) => s.game.scenario);
  const update = useStore((s) => s.updateScenario);
  const generate = useStore((s) => s.generateScenarioField);
  const generateRow = useStore((s) => s.generateSeedRow);
  const generateBundle = useStore((s) => s.generateScenarioBundle);
  const bundlePending = useStore((s) => s.fieldGenPending);
  const bundleError = useStore((s) => s.fieldGenError);
  const [genField, setGenField] = useState<ScenarioField | null>(null);
  const [genRow, setGenRow] = useState<{ kind: SeedRowKind; index: number } | null>(null);

  const coverUrl = useStore((s) => s.images[coverKey()]);
  const coverPending = useStore((s) => s.imgPending[coverKey()]);
  const uploadCover = useStore((s) => s.uploadCover);
  const coverFile = useRef<HTMLInputElement>(null);

  const genButton = (field: ScenarioField) => (
    <button
      type="button"
      aria-label={`Generate ${SCENARIO_FIELD_LABEL[field]}`}
      onClick={() => setGenField(field)}
      className={`${pillOutline} !min-h-9 !px-3`}
    >
      ✦
    </button>
  );

  const rowGenButton = (kind: SeedRowKind, index: number) => (
    <button
      type="button"
      aria-label={`Generate ${kind === "faction" ? "Faction" : "Fixed Point"}`}
      onClick={() => setGenRow({ kind, index })}
      className={`${pillOutline} !min-h-9 !px-3`}
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
      <MaterialHeader title="Scenario" back />

      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        <div className="relative isolate h-[180px] overflow-hidden rounded-[16px] bg-[var(--m-surface)]">
          {coverUrl && (
            <img src={coverUrl} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />
          )}
          <input
            ref={coverFile}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadCover(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label={coverUrl ? "Change cover image" : "Add cover image"}
            disabled={coverPending}
            onClick={() => coverFile.current?.click()}
            className={`absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40 ${
              coverUrl ? "text-paper" : "text-ink"
            }`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19 3 20l1-4z" />
            </svg>
          </button>
          {!coverUrl && (
            <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--m-text-40)]">
              Drop cover art
            </span>
          )}
        </div>

        <div className="space-y-1">
          <span className={fieldLabel}>Title</span>
          <input
            value={scenario.title}
            onChange={(e) => update({ title: e.target.value })}
            className={filledInput}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className={fieldLabel}>Premise</span>
            {genButton("premise")}
          </div>
          <textarea
            value={scenario.premise}
            rows={4}
            onChange={(e) => update({ premise: e.target.value })}
            className={filledTextarea}
          />
        </div>

        <div className="space-y-1.5">
          <button
            type="button"
            disabled={bundlePending || !scenario.premise.trim()}
            onClick={() => void generateBundle()}
            className={`w-full ${pillOutline}`}
          >
            {bundlePending ? "Generating…" : "✦ Auto-Generate Other Fields"}
          </button>
          <p className="text-[12px] leading-relaxed text-[var(--m-text-55)]">
            Writes Title, Starting Location, Tone, Physical Logic, Danger Curve, two Factions and
            Opening Narration from the Premise above — no preview, replaces them immediately.
          </p>
          {bundleError && (
            <p className={`${card} text-[13px]`} role="alert">
              {bundleError}
            </p>
          )}
        </div>

        {(["tone", "physicalLogic", "dangerCurve"] as const).map((field) => (
          <div key={field} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className={fieldLabel}>{SCENARIO_FIELD_LABEL[field]} (one per line)</span>
              {genButton(field)}
            </div>
            <textarea
              value={scenario[field].join("\n")}
              rows={3}
              onChange={(e) => update({ [field]: splitLines(e.target.value) })}
              className={filledTextarea}
            />
          </div>
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

        <div className="space-y-1">
          <span className={fieldLabel}>Open Threads (one per line)</span>
          <textarea
            value={scenario.threads.join("\n")}
            rows={3}
            placeholder="What happened to the missing captain?"
            onChange={(e) => update({ threads: splitLines(e.target.value) })}
            className={filledTextarea}
          />
        </div>

        <div className="space-y-1">
          <span className={fieldLabel}>Starting Location</span>
          <input
            value={scenario.startLocation ?? ""}
            onChange={(e) => update({ startLocation: e.target.value })}
            placeholder="Where the adventure opens"
            className={filledInput}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className={fieldLabel}>Opening Narration</span>
            {genButton("openingNarration")}
          </div>
          <textarea
            value={scenario.openingNarration}
            rows={4}
            onChange={(e) => update({ openingNarration: e.target.value })}
            className={filledTextarea}
          />
        </div>

        <div className="space-y-1">
          <span className={fieldLabel}>Start Day</span>
          <input
            type="number"
            min={0}
            value={scenario.startDay}
            onChange={(e) => update({ startDay: Math.max(0, Number(e.target.value) || 0) })}
            className={`w-24 text-center tabular-nums ${filledInput}`}
          />
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
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
      <span className={fieldLabel}>{label}</span>
      {rows.length === 0 && <p className="text-[13px] text-[var(--m-text-55)]">None yet.</p>}
      {rows.map((row, i) => (
        <div key={i} className={`space-y-2 ${card}`}>
          <div className="flex items-center gap-2">
            <input
              value={row.name}
              placeholder="Name"
              onChange={(e) => onChange(i, { name: e.target.value })}
              className={`flex-1 font-medium ${filledInput}`}
            />
            {genButton(i)}
          </div>
          <textarea
            value={row.description}
            placeholder="Description"
            rows={2}
            onChange={(e) => onChange(i, { description: e.target.value })}
            className={`text-[13.5px] ${filledTextarea}`}
          />
          <button type="button" onClick={() => onRemove(i)} className={pillOutline}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd} className={`w-full ${pillOutline}`}>
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
