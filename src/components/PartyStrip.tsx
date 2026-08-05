import { useMemo } from "react";
import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import { PARTY_LIMIT, activeMembers } from "../lib/roster";
import type { PartyMember } from "../types";

/**
 * The party portrait strip — directly under the top bar, above the reading area.
 * A fixed row of PARTY_LIMIT portrait faces spanning the screen width, with
 * gutters between and at the sides. ACTIVE members only — the strip is who is in
 * the scene, so a benched member leaves an empty slot and is managed from the
 * Party screen. Tap a filled slot to open that character's full-screen sheet.
 * Empty slots always render so the row keeps its shape. Portraits drop into the
 * face; until then a filled slot shows initials. Portraits are zoomed 50% and
 * pinned to the top of the slot (`origin-top scale-150 object-top`) so the face
 * fills the frame instead of sitting small in a tall crop.
 *
 * The PC is NOT here: they are the top bar now (Header), portrait · name ·
 * hearts. Two reasons the strip is better for it — the player's own character
 * was taking one of four slots to say something the whole screen already
 * implies, and the strip is the SCENE, which is exactly the thing the PC is
 * never absent from. The freed slot went back to the companion cap, so
 * PARTY_LIMIT and the strip's width are the same number.
 *
 * Slot ratio is 4:5, a quarter shorter than the 3:5 it was: the face crop means
 * the extra height was never showing more of anybody, and the strip sits above
 * the reading area now, where every pixel it takes is one the prose does not
 * get. A party of NOBODY collapses the whole grid to one row rather than
 * standing empty dashed boxes on screen.
 *
 * No name label under the face: portraits the player picked and generated are
 * already recognisable faces, and the caption was a second row of chrome saying
 * what the picture said. The name still reaches assistive tech through
 * `aria-label`, and taps still open the sheet, which is where it is spelled out.
 */
export function PartyStrip() {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);
  const images = useStore((s) => s.images);
  const streaming = useStore((s) => s.streaming);

  const members = useMemo(() => activeMembers(characters, roster), [characters, roster]);

  // Travelling alone, the strip was four full-height dashed boxes — ~140px of a
  // phone spent saying "nobody here". One row says it better.
  if (!members.length) {
    return (
      <nav className="flex items-stretch px-3 pt-3">
        <button
          type="button"
          disabled={streaming}
          onClick={() => setScreen("characters")}
          className="flex-1 border-2 border-dashed border-ink px-2 py-1 text-xs uppercase tracking-widest opacity-60 disabled:opacity-30 active:bg-ink active:text-paper active:opacity-100"
        >
          + Add companions
        </button>
      </nav>
    );
  }

  const slots: (PartyMember | null)[] = Array.from(
    { length: PARTY_LIMIT },
    (_, i) => members[i] ?? null,
  );

  return (
    <nav
      className="grid gap-3 px-3 pt-3"
      style={{ gridTemplateColumns: `repeat(${PARTY_LIMIT}, minmax(0, 1fr))` }}
    >
      {slots.map((c, i) =>
        c ? (
          <button
            key={c.id}
            type="button"
            disabled={streaming}
            onClick={() => openMember(c.id)}
            className="flex flex-col items-center disabled:opacity-40 active:opacity-60"
            aria-label={c.name}
          >
            <span className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
              {images[portraitKey(c.id)] ? (
                <img
                  src={images[portraitKey(c.id)]}
                  alt={c.name}
                  className="h-full w-full origin-top scale-150 object-cover object-top"
                />
              ) : (
                initials(c)
              )}
            </span>
          </button>
        ) : (
          <button
            key={`empty-${i}`}
            type="button"
            disabled={streaming}
            onClick={() => setScreen("characters")}
            className="flex flex-col items-center disabled:opacity-40 active:opacity-60"
            aria-label="Add party member"
          >
            <span className="flex aspect-[4/5] w-full items-center justify-center border-2 border-dashed border-ink text-sm font-bold opacity-30" />
          </button>
        ),
      )}
    </nav>
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
