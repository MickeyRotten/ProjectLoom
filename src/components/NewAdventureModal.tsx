import { useEffect, useRef, useState } from "react";
import type { AdventureImports, GameState } from "../types";
import { DEFAULT_ADVENTURE_IMPORTS } from "../lib/defaults";
import { Modal, Switch, pillOutline, pillSolid } from "./material";

/**
 * What to carry into a New Adventure (`AdventureImports`). Material redesign
 * (`Loom Material Redesign.dc.html`) — the shared `Modal` scrim/panel shape.
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
  const first = useRef<HTMLButtonElement>(null);
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
    {
      key: "places",
      label: "Places",
      note: count(game.places.length, "place", "Areas you have travelled to"),
    },
  ];

  return (
    <Modal label="Start a new adventure" onClose={onClose}>
      <h2 className="text-[16px] font-semibold">Start a new adventure?</h2>
      <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
        The game you are playing now is replaced. Snapshot it under Saves first if you
        want it back. Tick what the new adventure should start with.
      </p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--m-surface-strong)] px-3.5 py-3"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">{row.label}</span>
              <span className="block text-[12.5px] text-[var(--m-text-55)]">{row.note}</span>
            </span>
            <Switch
              ref={i === 0 ? first : undefined}
              on={imports[row.key]}
              ariaLabel={row.label}
              onClick={() => setImports((prev) => ({ ...prev, [row.key]: !prev[row.key] }))}
            />
          </div>
        ))}
      </div>

      <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
        The party always starts empty, and beats, quests, inventory and journal always
        start fresh.
      </p>

      <div className="flex gap-2">
        <button type="button" onClick={() => onStart(imports)} className={`flex-1 ${pillSolid}`}>
          New adventure
        </button>
        <button type="button" onClick={onClose} className={`flex-1 ${pillOutline}`}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** "3 characters" / "1 character" / the empty-case caption. */
function count(n: number, noun: string, empty: string): string {
  if (!n) return `None — ${empty.toLowerCase()}`;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
