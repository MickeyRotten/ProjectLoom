import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { PARTY_LIMIT } from "../lib/defaults";

/**
 * Full-screen PARTY view — manage the active company. Every member (enlisted or
 * benched) is listed; each row opens that member's sheet, with an inline
 * enlist/bench toggle. The active party is capped at PARTY_LIMIT (PC + 3), so
 * ENLIST disables once full. Reached from the fixed PARTY button.
 */
export function PartyScreen() {
  const members = useStore((s) => s.game.characters.filter((c) => c.role === "member"));
  const openMember = useStore((s) => s.openMember);
  const setInParty = useStore((s) => s.setInParty);
  const setScreen = useStore((s) => s.setScreen);

  const active = members.filter((m) => m.inParty).length;
  const full = active >= PARTY_LIMIT;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={`Party ${active}/${PARTY_LIMIT}`} onBack={() => setScreen(null)} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {members.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">
            No members yet — add them in Characters.
          </p>
        )}
        {members.map((m) => (
          <div key={m.id} className="border-2 border-ink">
            <button
              type="button"
              onClick={() => openMember(m.id)}
              className="block w-full p-3 text-left active:bg-ink active:text-paper"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold uppercase tracking-wide">
                  {m.name || "(unnamed)"}
                </span>
                <span className="text-sm opacity-70">
                  {m.species}
                  {m.inParty ? "" : " · benched"}
                </span>
              </div>
              {m.fieldSkill.name && (
                <p className="mt-1 text-sm opacity-80">Field Skill — {m.fieldSkill.name}</p>
              )}
            </button>
            <button
              type="button"
              disabled={!m.inParty && full}
              onClick={() => setInParty(m.id, !m.inParty)}
              className="w-full border-t-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
            >
              {m.inParty ? "Bench" : full ? "Party Full" : "Enlist"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
