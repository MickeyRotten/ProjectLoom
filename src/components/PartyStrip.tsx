import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import type { Character } from "../types";

/**
 * The party portrait strip — always visible below the AI options, above the
 * fixed buttons (DESIGN.md → UI). One chip per in-company member; tap opens
 * that member's full-screen sheet. Portraits (Phase 3) drop into the chip
 * face; until then the chip shows the member's initials.
 */
export function PartyStrip() {
  const members = useStore((s) =>
    s.game.characters.filter((c) => c.role === "member" && c.inParty),
  );
  const openMember = useStore((s) => s.openMember);
  const images = useStore((s) => s.images);

  if (!members.length) return null;

  return (
    <nav className="flex gap-2 overflow-x-auto border-t-2 border-ink p-2">
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => openMember(m.id)}
          className="flex shrink-0 flex-col items-center gap-1 active:opacity-60"
          aria-label={m.name}
        >
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden border-2 border-ink text-sm font-bold">
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
          <span className="max-w-[4.5rem] truncate text-[0.65rem] uppercase tracking-wide">
            {m.name}
          </span>
        </button>
      ))}
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
