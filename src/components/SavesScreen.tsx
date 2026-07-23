import { useEffect, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { btn, btnSmall } from "./fields";

/**
 * Saves (DESIGN.md → Menu): named snapshot slots of the whole active game.
 * Snapshot the current game under a name, restore a slot (replacing the active
 * game), or delete one. The active game keeps autosaving independently.
 */
export function SavesScreen() {
  const slots = useStore((s) => s.slots);
  const refreshSlots = useStore((s) => s.refreshSlots);
  const snapshotSlot = useStore((s) => s.snapshotSlot);
  const restoreSlot = useStore((s) => s.restoreSlot);
  const dropSlot = useStore((s) => s.dropSlot);
  const setScreen = useStore((s) => s.setScreen);
  const [name, setName] = useState("");

  useEffect(() => {
    void refreshSlots();
  }, [refreshSlots]);

  const doSave = () => {
    void snapshotSlot(name);
    setName("");
  };

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Saves" onBack={() => setScreen("menu")} />

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

        {slots.length === 0 && (
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
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Restore "${s.name}"? The current game is replaced.`)) {
                    void restoreSlot(s.id);
                  }
                }}
                className={btnSmall}
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${s.name}"?`)) void dropSlot(s.id);
                }}
                className={`ml-auto ${btnSmall}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
