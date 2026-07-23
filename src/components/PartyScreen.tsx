import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";

/**
 * Full-screen PARTY view — the in-company roster as tappable rows, each
 * opening that member's sheet. Reached from the fixed PARTY button.
 */
export function PartyScreen() {
  const members = useStore((s) =>
    s.game.characters.filter((c) => c.role === "member" && c.inParty),
  );
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Party" onBack={() => setScreen(null)} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {members.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">You travel alone.</p>
        )}
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => openMember(m.id)}
            className="block w-full border-2 border-ink p-3 text-left active:bg-ink active:text-paper"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold uppercase tracking-wide">{m.name}</span>
              <span className="text-sm opacity-70">{m.species}</span>
            </div>
            {m.description && <p className="mt-1 text-sm">{m.description}</p>}
            {m.fieldSkill.name && (
              <p className="mt-1 text-sm opacity-80">Field Skill — {m.fieldSkill.name}</p>
            )}
          </button>
        ))}
      </div>
    </main>
  );
}
