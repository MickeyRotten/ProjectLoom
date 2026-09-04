import { useMemo } from "react";
import { useStore } from "../store";
import { playerCharacter } from "../lib/roster";

/**
 * The top bar — one thin status line, half the height of the old PC block it
 * replaced. Portrait, name-as-button and the placeholder hearts are gone (the
 * PC's sheet is still reachable from Characters); the gear button moved to
 * `BottomNav`'s MENU square. What is left is pure status: who you are playing,
 * and the three facts that change turn to turn — day, turn count, weather —
 * so the reading area below never has to restate them.
 */
export function Header() {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);
  const day = useStore((s) => s.game.day);
  const turnNumber = useStore((s) => s.game.turnNumber);
  const weather = useStore((s) => s.game.weather);

  return (
    <header className="flex shrink-0 items-center bg-ink px-3 py-1 text-paper">
      <span className="min-w-0 flex-1 truncate text-xs uppercase tracking-widest">
        {pc?.name ?? "—"} | Day {day} | Turn {turnNumber}
        {weather ? ` | (${weather})` : ""}
      </span>
    </header>
  );
}
