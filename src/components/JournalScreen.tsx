import { useState } from "react";
import type { JournalEntry } from "../types";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { AreaField, btnSmall } from "./fields";
import { MenuLink } from "./SubMenuScreen";
import { useConfirm } from "./useConfirm";

/**
 * The Journal (DESIGN.md → Long-game memory): what has already happened, as
 * terse dated lists.
 *
 * The rolling history window drops old beats, and this is what catches them.
 * Entries are written at a boundary the client picks — a night's rest that
 * lands in a new day, or a turn ceiling — and each carries two kinds of line:
 * the facts the client read straight off the turn's deltas, and the lines the
 * model wrote for everything that left no state change behind.
 *
 * Every entry is editable and deletable here, which is the whole argument for a
 * journal over a hidden rolling summary: a summary that quietly gets a fact
 * wrong is unfixable, and this is one screen away.
 *
 * Note the asymmetry with the prompt: the model is shown a bounded, decaying
 * tail (`prompt.ts → formatJournalBlock`), while the player keeps every entry
 * forever. Same data, two products.
 */
export function JournalScreen() {
  const journal = useStore((s) => s.game.journal);
  const enabled = useStore((s) => s.settings.journalEnabled);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Journal" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {!enabled && (
          <p className="border-2 border-ink p-3 text-xs uppercase tracking-widest opacity-70">
            Journal is off —{" "}
            <MenuLink screen="narrator" section="memory">
              Narrator → Memory
            </MenuLink>
            . Entries below are kept and return when it is switched back on.
          </p>
        )}

        {journal.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">Nothing written yet.</p>
        )}

        {/* Newest first — the same order the narrator reads them in. */}
        {[...journal].reverse().map((entry) => (
          <EntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </main>
  );
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  const updateJournalEntry = useStore((s) => s.updateJournalEntry);
  const deleteJournalEntry = useStore((s) => s.deleteJournalEntry);
  const writeJournalEntry = useStore((s) => s.writeJournalEntry);
  const pending = useStore((s) => s.journalPending);
  const { ask, dialog } = useConfirm();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const asText = (e: JournalEntry) => e.lines.map((l) => l.text).join("\n");

  const startEdit = () => {
    setDraft(asText(entry));
    setEditing(true);
  };

  // An edited entry is the player's from then on: their lines are stored as
  // `model` so a later rewrite replaces them and the client's own facts — which
  // it can always re-derive — stay marked as facts.
  const commit = () => {
    const lines = draft
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    const facts = entry.lines.filter((l) => l.source === "system");
    const kept = lines.map((text) => ({
      text,
      source: facts.some((f) => f.text === text) ? ("system" as const) : ("model" as const),
    }));
    updateJournalEntry(entry.id, kept);
    setEditing(false);
  };

  const written = entry.lines.some((l) => l.source === "model");

  return (
    <div className="space-y-3 border-2 border-ink p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="uppercase tracking-widest">Day {entry.day}</span>
        <span className="text-xs uppercase tracking-widest opacity-60">
          Turns {entry.fromTurn}–{entry.throughTurn}
        </span>
      </div>

      {editing ? (
        <>
          <AreaField
            label="Lines (one per line)"
            value={draft}
            rows={Math.max(4, draft.split("\n").length + 1)}
            placeholder="Crossed the marsh at dusk."
            onChange={setDraft}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={commit} className={btnSmall}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={btnSmall}>
              Discard Changes
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="space-y-1">
            {entry.lines.length === 0 && (
              <li className="opacity-40">— nothing recorded —</li>
            )}
            {entry.lines.map((line, i) => (
              <li key={i} className="break-words">
                {/* The facts the client derived carry a mark, so the player can
                    see at a glance which lines a rewrite will replace. */}
                <span className="opacity-40">{line.source === "system" ? "▪" : "·"}</span>{" "}
                {line.text}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} className={btnSmall}>
              Edit
            </button>
            {/* The retry for a call that failed, and the rewrite for one that
                came out badly. Facts are never thrown away by either. */}
            <button
              type="button"
              disabled={pending}
              onClick={() => void writeJournalEntry(entry.id, written)}
              className={btnSmall}
            >
              {pending ? "Writing…" : written ? "Rewrite" : "Write Entry"}
            </button>
            <button
              type="button"
              onClick={() =>
                ask(
                  {
                    title: `Delete the Day ${entry.day} entry?`,
                    body: "The narrator loses this stretch of the adventure for good.",
                    confirmLabel: "Delete",
                  },
                  () => deleteJournalEntry(entry.id),
                )
              }
              className={btnSmall}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {dialog}
    </div>
  );
}
