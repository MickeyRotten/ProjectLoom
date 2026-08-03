import { useEffect, useRef, useState } from "react";
import type { AdventureImports, GameState } from "../types";
import { DEFAULT_ADVENTURE_IMPORTS } from "../lib/defaults";
import { btn } from "./fields";

/**
 * What to carry into a New Adventure (`AdventureImports`).
 *
 * This used to be a plain confirm — "your Characters are kept and NPCs carry
 * over" — because there was nothing to decide: the cast was global and survived
 * whatever you did. Now that it belongs to the adventure, starting a new one is
 * a choice about four separate things, and the app has no way to guess which. A
 * player starting a sequel in a world they wrote wants all four; a player
 * finally done with that world wants none of them.
 *
 * Each row says what it holds and how much of it, read off the game being
 * replaced — "3 characters", "12 world notes" — so the decision is made against
 * the actual contents rather than an abstraction.
 */
export function NewAdventureModal({
  game,
  onStart,
  onClose,
}: {
  game: GameState;
  onStart: (imports: AdventureImports) => void;
  onClose: () => void;
}) {
  const [imports, setImports] = useState<AdventureImports>(DEFAULT_ADVENTURE_IMPORTS);
  const first = useRef<HTMLInputElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const pc = game.characters.find((c) => c.role === "pc");
  const cast = game.characters.filter((c) => c.role !== "pc");

  const rows: { key: keyof AdventureImports; label: string; note: string }[] = [
    {
      key: "scenario",
      label: "Scenario & Opening",
      note: game.scenario.title.trim() || "Untitled — premise, opening narration, start",
    },
    {
      key: "pc",
      label: "Player Character",
      note: pc?.name.trim() ? `${pc.name} — your sheet, as authored` : "The default hero",
    },
    {
      key: "characters",
      label: "Characters",
      note: count(cast.length, "character", "The rest of the cast"),
    },
    {
      key: "worldNotes",
      label: "World Notes",
      note: count(game.worldNotes.length, "note", "Lore the story remembers"),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a new adventure"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink opacity-80"
      />
      <div className="relative max-h-full w-full max-w-sm space-y-3 overflow-y-auto border-2 border-ink bg-paper p-4">
        <p className="uppercase tracking-widest">Start a new adventure?</p>
        <p className="text-sm opacity-80">
          The game you are playing now is replaced. Snapshot it under Saves first if you
          want it back. Tick what the new adventure should start with.
        </p>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <label
              key={row.key}
              className="flex min-h-11 w-full items-start gap-3 border-2 border-ink p-3"
            >
              <input
                ref={i === 0 ? first : undefined}
                type="checkbox"
                checked={imports[row.key]}
                onChange={(e) =>
                  setImports((prev) => ({ ...prev, [row.key]: e.target.checked }))
                }
                className="mt-1 h-4 w-4 shrink-0 accent-ink"
              />
              <span className="min-w-0">
                <span className="block uppercase tracking-wide">{row.label}</span>
                <span className="block text-sm opacity-70">{row.note}</span>
              </span>
            </label>
          ))}
        </div>

        <p className="text-sm opacity-60">
          The party always starts empty, and beats, quests, inventory and journal always
          start fresh.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onStart(imports)}
            className={`flex-1 ${btn}`}
          >
            New adventure
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 opacity-70 active:opacity-100 ${btn}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** "3 characters" / "1 character" / the empty-case caption. */
function count(n: number, noun: string, empty: string): string {
  if (!n) return `None — ${empty.toLowerCase()}`;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
