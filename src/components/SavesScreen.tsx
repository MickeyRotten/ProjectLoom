import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { SaveSlot } from "../lib/db";
import { OverlayHeader } from "./OverlayHeader";
import { btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";

/**
 * Saves (DESIGN.md → Menu): named snapshot slots of the whole active game.
 * Snapshot the current game under a name, restore a slot (replacing the active
 * game), or delete one. The active game keeps autosaving independently.
 *
 * "The whole active game" now means the cast and the player character too —
 * they live in `GameState`, so a restored slot gives back the people the story
 * was saved with rather than whoever happens to be in the app.
 */
/** The player character a slot was saved with, or "" for a pre-cast slot. */
const pcName = (slot: SaveSlot): string =>
  slot.game.characters?.find((c) => c.role === "pc")?.name.trim() ?? "";

export function SavesScreen() {
  const slots = useStore((s) => s.slots);
  const refreshSlots = useStore((s) => s.refreshSlots);
  const snapshotSlot = useStore((s) => s.snapshotSlot);
  const overwriteSlot = useStore((s) => s.overwriteSlot);
  const restoreSlot = useStore((s) => s.restoreSlot);
  const dropSlot = useStore((s) => s.dropSlot);
  const [name, setName] = useState("");
  // Slots start empty and fill in after `refreshSlots` resolves, so the
  // "no saves" line used to flash on every open.
  const [loaded, setLoaded] = useState(false);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void refreshSlots().finally(() => setLoaded(true));
  }, [refreshSlots]);

  const doSave = () => {
    void snapshotSlot(name);
    setName("");
  };

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Saves" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest text-sm">Snapshot current game</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="save name (optional)"
            className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
          />
          <button type="button" onClick={doSave} className={`w-full ${btn}`}>
            Save Snapshot
          </button>
        </div>

        {loaded && slots.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">No saved slots.</p>
        )}

        {slots.map((s) => (
          <div key={s.id} className="space-y-2 border-2 border-ink p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold uppercase tracking-wide">{s.name}</span>
              <span className="text-xs opacity-70">{new Date(s.savedAt).toLocaleString()}</span>
            </div>
            <div className="text-sm opacity-70">
              {s.game.scenario.title} · Day {s.game.day} · Turn {s.game.turnNumber}
              {/* Whose story it is — the one thing a restore now brings back
                  that it didn't before. Absent on slots taken while the cast
                  lived outside the game, which restore the cast in hand. */}
              {pcName(s) && ` · ${pcName(s)}`}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: `Restore "${s.name}"?`,
                      body: "The game you are playing now is replaced — its cast and player character included. Snapshot it first if you want to keep it.",
                      confirmLabel: "Restore",
                    },
                    () => void restoreSlot(s.id),
                  )
                }
                className={btnSmall}
              >
                Restore
              </button>
              {/* Overwrite in place: same slot, same name, current game. The
                  alternative was a second save with the same name beside the
                  first, which is what the list fills up with otherwise. */}
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: `Overwrite "${s.name}"?`,
                      body: "The snapshot stored in this slot is replaced by the game you are playing now. It cannot be recovered.",
                      confirmLabel: "Overwrite",
                    },
                    () => void overwriteSlot(s.id),
                  )
                }
                className={btnSmall}
              >
                Overwrite
              </button>
              <button
                type="button"
                onClick={() =>
                  ask(
                    { title: `Delete "${s.name}"?`, confirmLabel: "Delete" },
                    () => void dropSlot(s.id),
                  )
                }
                className={`ml-auto ${btnSmall}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {dialog}
    </main>
  );
}
