import { useMemo, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { CharacterRow } from "./CharacterRow";
import { btn } from "./fields";
import { PARTY_LIMIT } from "../lib/defaults";
import { allMembers, partyCount } from "../lib/roster";

/** Above this many characters the list gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * Characters (DESIGN.md → Menu) — the GLOBAL cast library. Every character ever
 * authored or written into the story lives here and survives New Adventure;
 * being in the party is a separate, per-adventure thing managed from these rows
 * (or the member sheet). "+ New Character" creates someone in the library only —
 * you add them to the party from here. The PC is always present and can't be
 * removed (handled in the sheet + store).
 */
export function CharactersScreen() {
  const characters = useStore((s) => s.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const addCharacter = useStore((s) => s.addCharacter);
  const setInParty = useStore((s) => s.setInParty);

  const [filter, setFilter] = useState("");

  const resolved = useMemo(() => allMembers(characters, roster), [characters, roster]);
  const inParty = partyCount(roster);
  const full = inParty >= PARTY_LIMIT;

  const q = filter.trim().toLowerCase();
  const match = (name: string, species: string) =>
    !q || name.toLowerCase().includes(q) || species.toLowerCase().includes(q);

  const pc = resolved.filter((c) => c.role === "pc");
  const party = resolved.filter((c) => c.role === "member" && c.inParty);
  const rest = resolved.filter((c) => c.role === "member" && !c.inParty);

  const showFilter = resolved.length > FILTER_THRESHOLD;
  const visibleParty = party.filter((c) => match(c.name, c.species));
  const visibleRest = rest.filter((c) => match(c.name, c.species));

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={`Characters ${resolved.length}`} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or species"
            className="w-full border-2 border-ink bg-paper p-2 text-ink placeholder:opacity-40"
          />
        )}

        {pc.map((c) => (
          <CharacterRow
            key={c.id}
            name={c.name || "(unnamed)"}
            sub="Player Character"
            onOpen={() => openMember(c.id)}
          />
        ))}

        <Section label={`In Party ${inParty}/${PARTY_LIMIT}`} />
        {visibleParty.length === 0 && (
          <p className="text-sm uppercase tracking-widest opacity-60">
            Party is empty — add someone below.
          </p>
        )}
        {visibleParty.map((c) => (
          <CharacterRow
            key={c.id}
            name={c.name || "(unnamed)"}
            sub={c.species}
            status={c.status}
            onOpen={() => openMember(c.id)}
            action={{ label: "Kick from Party", onClick: () => setInParty(c.id, false) }}
          />
        ))}

        {rest.length > 0 && <Section label="Everyone Else" />}
        {visibleRest.map((c) => (
          <CharacterRow
            key={c.id}
            name={c.name || "(unnamed)"}
            sub={c.species}
            status={c.status}
            onOpen={() => openMember(c.id)}
            action={{
              label: full ? "Party Full" : "Add to Party",
              disabled: full,
              onClick: () => setInParty(c.id, true),
            }}
          />
        ))}

        <button
          type="button"
          onClick={() => openMember(addCharacter())}
          className={`w-full ${btn}`}
        >
          + New Character
        </button>
      </div>
    </main>
  );
}

function Section({ label }: { label: string }) {
  return <p className="pt-2 text-sm uppercase tracking-widest opacity-60">{label}</p>;
}
