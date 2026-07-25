import { useMemo } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { CharacterRow } from "./CharacterRow";
import { btn } from "./fields";
import { PARTY_LIMIT } from "../lib/defaults";
import { partyMembers } from "../lib/roster";

/**
 * Full-screen PARTY view — who is travelling with the player right now, capped
 * at PARTY_LIMIT (PC + 3). This lists the party ONLY; the full cast lives on the
 * Characters screen, which is also where you recruit from. Kicking someone here
 * ends their party membership and nothing more — they stay in Characters.
 * Reached from the fixed PARTY button.
 */
export function PartyScreen() {
  const characters = useStore((s) => s.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setInParty = useStore((s) => s.setInParty);
  const setScreen = useStore((s) => s.setScreen);

  const party = useMemo(() => partyMembers(characters, roster), [characters, roster]);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={`Party ${party.length}/${PARTY_LIMIT}`} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {party.length === 0 && (
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
        {party.map((m) => (
          <CharacterRow
            key={m.id}
            name={m.name || "(unnamed)"}
            sub={m.species}
            detail={m.strengths ? `Strengths — ${m.strengths}` : undefined}
            onOpen={() => openMember(m.id)}
            action={{ label: "Kick from Party", onClick: () => setInParty(m.id, false) }}
          />
        ))}
      </div>
    </main>
  );
}
