import { useMemo } from "react";
import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import { activeMembers, playerCharacter } from "../lib/roster";
import type { PartyMember } from "../types";

/** Number of party members shown alongside the PC (PC + 3 = 4 slots). */
const MEMBER_SLOTS = 3;

/**
 * The party portrait strip — always visible below the AI options, above the
 * fixed buttons (DESIGN.md → UI). A fixed row of four portrait faces (the PC
 * plus MEMBER_SLOTS party members), spanning the screen width with gutters
 * between and at the sides. ACTIVE members only —
 * the strip is who is in the scene, so a benched member leaves an empty slot
 * and is managed from the Party screen. Tap a filled slot to
 * open that character's full-screen sheet. Empty member slots always render so
 * the row keeps its shape. Portraits (Phase 3) drop into the face; until then a
 * filled slot shows initials. Portraits are zoomed 50% and pinned to the top of
 * the slot (`origin-top scale-150 object-top`) so the face fills the frame
 * instead of sitting small in a tall crop.
 *
 * Two things here are about reclaiming the reading area, which the banner, this
 * strip and the composer together had squeezed to under half the viewport of a
 * text-first app: slots are capped in height (the face crop above means extra
 * height was never showing more of anybody), and a party of NOBODY collapses
 * the whole grid to one row instead of standing three full-height dashed boxes
 * on screen.
 *
 * No name label under the face: four portraits the player picked and generated
 * are already four recognisable faces, and the caption was a second row of
 * chrome saying what the picture said. The freed height goes back into the
 * portrait rather than off the strip — 3:5 slots against the old 3:4 face plus
 * caption — so the reading area keeps exactly what it had and the faces get
 * bigger. Empty slots take the same ratio so the row keeps its shape. The name
 * still reaches assistive tech through `aria-label`, and taps still open the
 * sheet, which is where the name is spelled out.
 */
export function PartyStrip() {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);
  const images = useStore((s) => s.images);
  const streaming = useStore((s) => s.streaming);

  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);
  const members = useMemo(() => activeMembers(characters, roster), [characters, roster]);

  // Travelling alone, the strip was three full-height dashed boxes and the PC —
  // ~140px of a phone spent saying "nobody here". One row says it better.
  if (!members.length) {
    return (
      <nav className="flex items-stretch gap-2 px-3 pt-3">
        {pc && (
          <button
            type="button"
            disabled={streaming}
            onClick={() => openMember(pc.id)}
            className="flex items-center gap-2 border-2 border-ink px-2 py-1 disabled:opacity-40 active:bg-ink active:text-paper"
            aria-label={pc.name}
          >
            <span className="flex h-6 w-6 items-center justify-center overflow-hidden border-2 border-ink text-xs font-bold">
              {images[portraitKey(pc.id)] ? (
                <img
                  src={images[portraitKey(pc.id)]}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full origin-top scale-150 object-cover object-top [image-rendering:pixelated]"
                />
              ) : (
                initials(pc)
              )}
            </span>
            <span className="text-xs uppercase tracking-widest">{pc.name}</span>
          </button>
        )}
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

  const slots: (PartyMember | null)[] = [
    pc ?? null,
    ...Array.from({ length: MEMBER_SLOTS }, (_, i) => members[i] ?? null),
  ];

  return (
    <nav className="grid grid-cols-4 gap-3 px-3 pt-3 pb-0">
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
            <span className="flex aspect-[3/5] w-full items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
              {images[portraitKey(c.id)] ? (
                <img
                  src={images[portraitKey(c.id)]}
                  alt={c.name}
                  className="h-full w-full origin-top scale-150 object-cover object-top [image-rendering:pixelated]"
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
            <span className="flex aspect-[3/5] w-full items-center justify-center border-2 border-dashed border-ink text-sm font-bold opacity-30" />
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
