import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import type { Character } from "../types";

/** Number of party members shown alongside the PC (PC + 3 = 4 slots). */
const MEMBER_SLOTS = 3;

/**
 * The party portrait strip — always visible below the AI options, above the
 * fixed buttons (DESIGN.md → UI). A fixed row of four portrait faces (the PC
 * plus MEMBER_SLOTS party members) with a name label under each, spanning the
 * screen width with gutters between and at the sides. Tap a filled slot to
 * open that character's full-screen sheet. Empty member slots always render so
 * the row keeps its shape. Portraits (Phase 3) drop into the face; until then a
 * filled slot shows initials.
 */
export function PartyStrip() {
  const pc = useStore((s) => s.game.characters.find((c) => c.role === "pc"));
  const members = useStore((s) =>
    s.game.characters.filter((c) => c.role === "member" && c.inParty),
  );
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);
  const images = useStore((s) => s.images);
  const streaming = useStore((s) => s.streaming);

  const slots: (Character | null)[] = [
    pc ?? null,
    ...Array.from({ length: MEMBER_SLOTS }, (_, i) => members[i] ?? null),
  ];

  return (
    <nav className="grid grid-cols-4 gap-2 p-2">
      {slots.map((c, i) =>
        c ? (
          <button
            key={c.id}
            type="button"
            disabled={streaming}
            onClick={() => openMember(c.id)}
            className="flex flex-col items-center gap-1 disabled:opacity-40 active:opacity-60"
            aria-label={c.name}
          >
            <span className="flex aspect-[1/2] w-full items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
              {images[portraitKey(c.id)] ? (
                <img
                  src={images[portraitKey(c.id)]}
                  alt={c.name}
                  className="h-full w-full object-cover [image-rendering:pixelated]"
                />
              ) : (
                initials(c)
              )}
            </span>
            <span className="w-full break-words border-2 border-ink px-1 py-1 text-center uppercase leading-tight">
              {c.name}
            </span>
          </button>
        ) : (
          <button
            key={`empty-${i}`}
            type="button"
            disabled={streaming}
            onClick={() => setScreen("characters")}
            className="flex flex-col items-center gap-1 disabled:opacity-40 active:opacity-60"
            aria-label="Add party member"
          >
            <span className="flex aspect-[1/2] w-full items-center justify-center border-2 border-dashed border-ink text-sm font-bold opacity-30">
              +
            </span>
            <span className="w-full border-2 border-transparent px-1 py-1 text-center uppercase leading-tight opacity-0">
              —
            </span>
          </button>
        ),
      )}
    </nav>
  );
}

function initials(c: Character): string {
  return c.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
