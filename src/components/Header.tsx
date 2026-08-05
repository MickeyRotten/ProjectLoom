import { useMemo } from "react";
import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import { playerCharacter } from "../lib/roster";
import type { PartyMember } from "../types";

/** Placeholder hit points. No health system exists yet — see below. */
const HEARTS = 6;

/**
 * The top bar — the PLAYER CHARACTER: a small square portrait, their name
 * beside it, a row of hearts under the name, and the menu button at the right
 * edge.
 *
 * It used to be the location bar: name of the place · day · menu. Both of those
 * facts are already in the reading area — `ChatView`'s scene marks rule off the
 * log with "Somewhere · Day 3" every time either one changes — so the bar was
 * spending the most valuable strip of a phone screen restating the line the
 * player had just read. The PC had no permanent place on screen at all; they
 * were one of four party-strip slots, which is backwards, since the strip is
 * who is IN the scene and the player never is not.
 *
 * The hearts are a PLACEHOLDER: six filled glyphs, drawn from nothing and
 * meaning nothing, holding the shape a future hit-point system would take. They
 * are `aria-hidden` precisely because of that — a screen reader announcing
 * "6 of 6 health" would be describing a mechanic this app does not have.
 */
export function Header() {
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 bg-ink px-3 py-2 text-paper">
      <PlayerBlock pc={pc} streaming={streaming} />
      <MenuButton streaming={streaming} onOpen={() => setScreen("menu")} />
    </header>
  );
}

/**
 * Portrait · name · hearts. One button, because it is one subject: tapping
 * anywhere on it opens the PC's sheet, which is the only route to them now that
 * they are out of the party strip.
 *
 * Everything visible inherits its colour (`border-current`), so the bar names a
 * foreground in exactly one place.
 */
function PlayerBlock({ pc, streaming }: { pc: PartyMember | undefined; streaming: boolean }) {
  const openMember = useStore((s) => s.openMember);
  const portrait = useStore((s) => (pc ? s.images[portraitKey(pc.id)] : undefined));
  if (!pc) return <span className="min-w-0 flex-1" />;

  return (
    <button
      type="button"
      disabled={streaming}
      onClick={() => openMember(pc.id)}
      aria-label={pc.name}
      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-40 active:opacity-60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border-2 border-current text-xs font-bold">
        {portrait ? (
          <img
            src={portrait}
            alt=""
            aria-hidden="true"
            className="h-full w-full origin-top scale-150 object-cover object-top [image-rendering:pixelated]"
          />
        ) : (
          initials(pc)
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate uppercase">{pc.name}</span>
        {/* Placeholder hit points — six full hearts, always. Hidden from
            assistive tech until they mean something. */}
        <span aria-hidden="true" className="text-xs leading-none tracking-widest">
          {"♥".repeat(HEARTS)}
        </span>
      </span>
    </button>
  );
}

function initials(c: PartyMember): string {
  return c.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** The gear button. */
function MenuButton({ streaming, onOpen }: { streaming: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Settings"
      disabled={streaming}
      onClick={onOpen}
      className="min-h-11 min-w-11 border-2 border-paper px-3 leading-none disabled:opacity-40 active:bg-paper active:text-ink"
    >
      =
    </button>
  );
}
