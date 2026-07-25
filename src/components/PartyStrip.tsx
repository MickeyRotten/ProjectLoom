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
 * plus MEMBER_SLOTS party members) with a name label under each, spanning the
 * screen width with gutters between and at the sides. ACTIVE members only —
 * the strip is who is in the scene, so a benched member leaves an empty slot
 * and is managed from the Party screen. Tap a filled slot to
 * open that character's full-screen sheet. Empty member slots always render so
 * the row keeps its shape. Portraits (Phase 3) drop into the face; until then a
 * filled slot shows initials. Portraits are zoomed 50% and pinned to the top of
 * the slot (`origin-top scale-150 object-top`) so the face fills the frame
 * instead of sitting small in a tall crop.
 */
export function PartyStrip() {
  const characters = useStore((s) => s.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);
  const images = useStore((s) => s.images);
  const streaming = useStore((s) => s.streaming);

  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);
  const members = useMemo(() => activeMembers(characters, roster), [characters, roster]);

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
            <span className="flex aspect-[1/2] w-full items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
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
            <span className="w-full break-words border-2 border-t-0 border-ink bg-ink px-1 py-1 text-center uppercase leading-tight text-paper">
              {c.name}
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
            <span className="flex aspect-[1/2] w-full items-center justify-center border-2 border-dashed border-ink text-sm font-bold opacity-30" />
            <span className="w-full border-2 border-t-0 border-transparent px-1 py-1 text-center uppercase leading-tight opacity-0">
              —
            </span>
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
