import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { PartyMember, Standing } from "../types";
import { OverlayHeader } from "./OverlayHeader";
import { CharacterRow, type RowAction } from "./CharacterRow";
import { Section, btn } from "./fields";
import { PARTY_LIMIT, allMembers, partyCount } from "../lib/roster";

/** Above this many characters the list gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * Characters (DESIGN.md → Menu) — the GLOBAL cast library. Every character ever
 * authored or written into the story lives here and survives New Adventure;
 * what they are to you *this* adventure — in the scene, benched, an ally, gone —
 * is a per-adventure standing managed from these rows (or the member sheet).
 * "+ New Character" creates someone in the library only. The PC is always
 * present and can't be removed (handled in the sheet + store).
 */
export function CharactersScreen() {
  const characters = useStore((s) => s.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const addCharacter = useStore((s) => s.addCharacter);
  const setStanding = useStore((s) => s.setStanding);

  const [filter, setFilter] = useState("");

  const resolved = useMemo(() => allMembers(characters, roster), [characters, roster]);
  const inParty = partyCount(characters, roster);
  const full = inParty >= PARTY_LIMIT;

  const q = filter.trim().toLowerCase();
  const match = (c: PartyMember) =>
    !q || c.name.toLowerCase().includes(q) || c.species.toLowerCase().includes(q);

  const pc = resolved.filter((c) => c.role === "pc");
  const at = (...standings: Standing[]) =>
    resolved.filter((c) => c.role === "member" && standings.includes(c.standing)).filter(match);

  const active = at("active");
  const benched = at("benched");
  const npcs = at("npc");
  const gone = at("departed", "fallen");
  const rest = at("none");

  /** Put someone in the scene — the one move the party cap can refuse. */
  const activate = (c: PartyMember): RowAction => ({
    label: full ? "Party Full" : "Add to Party",
    disabled: full,
    onClick: () => setStanding(c.id, "active"),
  });

  const showFilter = resolved.length > FILTER_THRESHOLD;

  const group = (label: string, members: PartyMember[], actions: (c: PartyMember) => RowAction[]) =>
    members.length > 0 && (
      <>
        <Section label={label} />
        {members.map((c) => (
          <CharacterRow
            key={c.id}
            name={c.name || "(unnamed)"}
            sub={c.species}
            standing={c.standing}
            onOpen={() => openMember(c.id)}
            actions={actions(c)}
          />
        ))}
      </>
    );

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
        {active.length === 0 && (
          <p className="text-sm uppercase tracking-widest opacity-60">
            Party is empty — add someone below.
          </p>
        )}
        {active.map((c) => (
          <CharacterRow
            key={c.id}
            name={c.name || "(unnamed)"}
            sub={c.species}
            standing={c.standing}
            onOpen={() => openMember(c.id)}
            actions={[
              { label: "Bench", onClick: () => setStanding(c.id, "benched") },
              { label: "Kick", onClick: () => setStanding(c.id, "none") },
            ]}
          />
        ))}

        {group("Benched", benched, (c) => [
          activate(c),
          { label: "Kick", onClick: () => setStanding(c.id, "none") },
        ])}

        {group("NPCs & Allies", npcs, (c) => [activate(c)])}

        {group("Gone", gone, (c) => [activate(c)])}

        {group("Everyone Else", rest, (c) => [
          activate(c),
          { label: "Make NPC", onClick: () => setStanding(c.id, "npc") },
        ])}

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
