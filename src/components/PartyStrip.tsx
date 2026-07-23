import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import type { Character } from "../types";

/** Fixed number of party portrait slots on the main screen. */
const SLOTS = 4;

/**
 * The party portrait strip — always visible below the AI options, above the
 * fixed buttons (DESIGN.md → UI). A fixed row of SLOTS portrait faces with a
 * name label under each; tap a filled slot to open that member's full-screen
 * sheet. Empty slots always render so the row keeps its shape. Portraits
 * (Phase 3) drop into the face; until then a filled slot shows initials.
 */
export function PartyStrip() {
  const members = useStore((s) =>
    s.game.characters.filter((c) => c.role === "member" && c.inParty),
  );
  const openMember = useStore((s) => s.openMember);
  const images = useStore((s) => s.images);

  const slots: (Character | null)[] = Array.from(
    { length: SLOTS },
    (_, i) => members[i] ?? null,
  );

  return (
    <nav className="grid grid-cols-4 gap-2 border-t-2 border-ink p-2">
      {slots.map((m, i) =>
        m ? (
          <button
            key={m.id}
            type="button"
            onClick={() => openMember(m.id)}
            className="flex flex-col items-center gap-1 active:opacity-60"
            aria-label={m.name}
          >
            <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
              {images[portraitKey(m.id)] ? (
                <img
                  src={images[portraitKey(m.id)]}
                  alt={m.name}
                  className="h-full w-full object-cover [image-rendering:pixelated]"
                />
              ) : (
                initials(m)
              )}
            </span>
            <span className="w-full truncate text-center text-[0.65rem] uppercase tracking-wide">
              {m.name}
            </span>
          </button>
        ) : (
          <div
            key={`empty-${i}`}
            className="flex flex-col items-center gap-1"
            aria-hidden="true"
          >
            <span className="flex aspect-[3/4] w-full items-center justify-center border-2 border-dashed border-ink text-sm font-bold opacity-30">
              +
            </span>
            <span className="text-[0.65rem] uppercase tracking-wide opacity-0">
              —
            </span>
          </div>
        ),
      )}
    </nav>
  );
}

function initials(m: Character): string {
  return m.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
