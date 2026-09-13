import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { SaveSlot } from "../lib/db";
import {
  MaterialHeader,
  card,
  fieldLabel,
  filledInput,
  pillDanger,
  pillOutline,
  pillSolid,
} from "./material";
import { useConfirm } from "./useConfirm";

/**
 * Saves (DESIGN.md → Menu) — Material redesign (`Loom Material
 * Redesign.dc.html`): named snapshot slots of the whole active game.
 * Snapshot the current game under a name, restore a slot (replacing the active
 * game), or delete one. The active game keeps autosaving independently.
 *
 * "The whole active game" now means the cast and the player character too —
 * they live in `GameState`, so a restored slot gives back the people the story
 * was saved with rather than whoever happens to be in the app.
 *
 * This is also the cloud's only surface. A slot uploads when it is taken, and
 * opening this screen is the one moment a pull is worth a round trip — cloud
 * saves are exactly what the player came here to look at. Pulled slots simply
 * appear in the list, so there is nothing to mark and nothing to press.
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
  const account = useStore((s) => s.account);
  const syncNow = useStore((s) => s.syncNow);
  const status = useStore((s) => s.syncStatus);
  const [name, setName] = useState("");
  // Slots start empty and fill in after `refreshSlots` resolves, so the
  // "no saves" line used to flash on every open.
  const [loaded, setLoaded] = useState(false);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void refreshSlots().finally(() => setLoaded(true));
  }, [refreshSlots]);

  // What is on the device shows immediately (above); the cloud's copies arrive
  // when they arrive. A pulled slot calls `slotsChanged`, which refreshes this
  // list on its own, so nothing here waits on the network.
  useEffect(() => {
    if (account) void syncNow();
  }, [account, syncNow]);

  const doSave = () => {
    void snapshotSlot(name);
    setName("");
  };

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Saves" back />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6">
        {/* Only when signed in: on a device that never syncs there is no cloud
            to have an opinion about, and a permanent "off" line would be noise
            on the screen the player uses most. */}
        {account && (
          <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]" role="status">
            {status.state === "syncing"
              ? "Checking the cloud…"
              : status.state === "error"
                ? `Cloud saves unavailable — ${status.error ?? "unknown error"}`
                : "Saves are kept in the cloud."}
          </p>
        )}

        <div className={`space-y-2.5 ${card}`}>
          <span className={fieldLabel}>Snapshot current game</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="save name (optional)"
            className={filledInput}
          />
          <button type="button" onClick={doSave} className={`w-full ${pillSolid}`}>
            Save Snapshot
          </button>
        </div>

        {loaded && slots.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">No saved slots.</p>
        )}

        {slots.map((s) => (
          <div key={s.id} className={`space-y-2 ${card}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-medium">{s.name}</span>
              <span className="shrink-0 text-[12px] text-[var(--m-text-55)]">
                {new Date(s.savedAt).toLocaleString()}
              </span>
            </div>
            <div className="text-[13px] text-[var(--m-text-55)]">
              {s.game.scenario.title} · Day {s.game.day} · Turn {s.game.turnNumber}
              {/* Whose story it is — the one thing a restore now brings back
                  that it didn't before. Absent on slots taken while the cast
                  lived outside the game, which restore the cast in hand. */}
              {pcName(s) && ` · ${pcName(s)}`}
            </div>
            <div className="flex flex-wrap gap-2">
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
                className={pillOutline}
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
                className={pillOutline}
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
                className={`ml-auto ${pillDanger}`}
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
