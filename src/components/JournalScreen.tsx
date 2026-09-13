import { useState } from "react";
import type { JournalEntry } from "../types";
import { useStore } from "../store";
import { FeatureOffNotice } from "./FeatureOffNotice";
import { MaterialHeader, card, fieldLabel, filledTextarea, pillOutline, pillSolid } from "./material";
import { useConfirm } from "./useConfirm";

/**
 * The Journal (DESIGN.md → Long-game memory) — Material redesign (`Loom
 * Material Redesign.dc.html`): entries as cards, newest first, with fact (▪)
 * vs. narrator-written (·) line markers and per-entry Edit/Write/Rewrite/
 * Delete pill actions. Reached from the bottom nav, which stays visible under
 * this screen (no Back).
 *
 * Every entry is editable and deletable here, which is the whole argument for
 * a journal over a hidden rolling summary: a summary that quietly gets a fact
 * wrong is unfixable, and this is one screen away.
 */
export function JournalScreen() {
  const journal = useStore((s) => s.game.journal);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Journal" />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <FeatureOffNotice feature="journal">
          Journal is off. Entries below are kept and return when it is switched back on
          —
        </FeatureOffNotice>

        {journal.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">Nothing written yet.</p>
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
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold uppercase tracking-wide">Day {entry.day}</span>
        <span className="text-[12px] text-[var(--m-text-40)]">
          Turns {entry.fromTurn}–{entry.throughTurn}
        </span>
      </div>

      {editing ? (
        <div className="mt-2.5 space-y-2.5">
          <div className="space-y-1">
            <span className={fieldLabel}>Lines (one per line)</span>
            <textarea
              value={draft}
              rows={Math.max(4, draft.split("\n").length + 1)}
              placeholder="Crossed the marsh at dusk."
              onChange={(e) => setDraft(e.target.value)}
              className={`text-[13.5px] ${filledTextarea}`}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={commit} className={`flex-1 ${pillSolid}`}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`flex-1 ${pillOutline}`}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-2.5 space-y-1.5">
            {entry.lines.length === 0 && (
              <li className="text-[13.5px] text-[var(--m-text-40)]">— nothing recorded —</li>
            )}
            {entry.lines.map((line, i) => (
              <li key={i} className="break-words text-[13.5px] leading-relaxed text-[var(--m-text-70)]">
                {/* The facts the client derived carry a mark, so the player can
                    see at a glance which lines a rewrite will replace. */}
                <span className="mr-1.5 text-[var(--m-text-40)]">
                  {line.source === "system" ? "▪" : "·"}
                </span>
                {line.text}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} className={pillOutline}>
              Edit
            </button>
            {/* The retry for a call that failed, and the rewrite for one that
                came out badly. Facts are never thrown away by either. */}
            <button
              type="button"
              disabled={pending}
              onClick={() => void writeJournalEntry(entry.id, written)}
              className={pillOutline}
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
              className="ml-auto inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--m-danger-border)] px-4 text-[13px] font-semibold text-danger"
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
