import { useMemo } from "react";
import { useStore } from "../store";
import type { PartyMember } from "../types";
import { OverlayHeader } from "./OverlayHeader";
import { CharacterRow } from "./CharacterRow";
import { Section, btn } from "./fields";
import { PARTY_LIMIT, activeMembers, benchedMembers } from "../lib/roster";

/**
 * Full-screen PARTY view — the company, in two halves: who is in the scene
 * (capped at PARTY_LIMIT, PC + 3) and who is BENCHED, still one of yours but
 * waiting elsewhere. The bench is uncapped, so this is where a long-running
 * adventure keeps its stable.
 *
 * The full cast lives on the Characters screen, which is also where you
 * recruit from. Kicking someone here drops them out of the party entirely —
 * they stay in Characters, and nothing is written into the story about it.
 * Reached from the fixed PARTY button.
 */
export function PartyScreen() {
  const characters = useStore((s) => s.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setStanding = useStore((s) => s.setStanding);
  const setScreen = useStore((s) => s.setScreen);

  const active = useMemo(() => activeMembers(characters, roster), [characters, roster]);
  const benched = useMemo(() => benchedMembers(characters, roster), [characters, roster]);
  const full = active.length >= PARTY_LIMIT;

  const row = (m: PartyMember, move: { label: string; to: "active" | "benched" }) => (
    <CharacterRow
      key={m.id}
      name={m.name || "(unnamed)"}
      sub={m.species}
      detail={m.strengths.name ? `Strengths — ${m.strengths.name}` : undefined}
      onOpen={() => openMember(m.id)}
      actions={[
        {
          label: move.to === "active" && full ? "Party Full" : move.label,
          disabled: move.to === "active" && full,
          onClick: () => setStanding(m.id, move.to),
        },
        { label: "Kick", onClick: () => setStanding(m.id, "none") },
      ]}
    />
  );

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={`Party ${active.length}/${PARTY_LIMIT}`} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {active.length === 0 && benched.length === 0 && (
          <>
            <p className="uppercase tracking-widest opacity-60">
              No one is travelling with you.
            </p>
            <button
              type="button"
              onClick={() => setScreen("characters")}
              className={`w-full ${btn}`}
            >
              Go to Characters
            </button>
          </>
        )}

        {active.length > 0 && <Section label={`In the scene ${active.length}/${PARTY_LIMIT}`} />}
        {active.map((m) => row(m, { label: "Bench", to: "benched" }))}

        {benched.length > 0 && <Section label="Benched" />}
        {benched.map((m) => row(m, { label: "Activate", to: "active" }))}
      </div>
    </main>
  );
}
