import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { PartyMember, Standing } from "../types";
import { CharacterRow, type RowAction } from "./CharacterRow";
import { MaterialHeader, filledInput, pillSolid, sectionHeading } from "./material";
import { PARTY_LIMIT, allMembers, partyCount } from "../lib/roster";
import { firstBlockText } from "../lib/blocks";

/** Above this many characters the list gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * Characters (DESIGN.md → Menu) — Material redesign (`Loom Material
 * Redesign.dc.html`): THIS adventure's cast, one filled surface card per
 * person, grouped by standing. Every character authored or written into the
 * story lives here; what they are to you right now — in the scene, benched,
 * an ally, gone — is a standing managed from these rows (or the member
 * sheet). "+ New Character" creates someone in the cast without putting them
 * in the party. The PC is always present and can't be removed (handled in
 * the sheet + store).
 *
 * The cast belongs to the adventure: a save slot restores the people it was
 * taken with, and New Adventure asks which of them to bring.
 */
export function CharactersScreen() {
  const characters = useStore((s) => s.game.characters);
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

  const detail = (c: PartyMember) => firstBlockText(c.blocks, "strengths");

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
        <p className={sectionHeading}>{label}</p>
        <div className="space-y-2.5">
          {members.map((c) => (
            <CharacterRow
              key={c.id}
              id={c.id}
              name={c.name || "(unnamed)"}
              sub={c.species}
              detail={detail(c)}
              standing={c.standing}
              onOpen={() => openMember(c.id)}
              actions={actions(c)}
            />
          ))}
        </div>
      </>
    );

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title={`Characters ${resolved.length}`} back />

      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-6">
        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or species"
            className={filledInput}
          />
        )}

        {pc.map((c) => (
          <CharacterRow
            key={c.id}
            id={c.id}
            name={c.name || "(unnamed)"}
            sub="Player Character"
            onOpen={() => openMember(c.id)}
          />
        ))}

        <p className={sectionHeading}>
          In Party {inParty}/{PARTY_LIMIT}
        </p>
        {active.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">Party is empty — add someone below.</p>
        )}
        <div className="space-y-2.5">
          {active.map((c) => (
            <CharacterRow
              key={c.id}
              id={c.id}
              name={c.name || "(unnamed)"}
              sub={c.species}
              detail={detail(c)}
              standing={c.standing}
              onOpen={() => openMember(c.id)}
              actions={[
                { label: "Bench", onClick: () => setStanding(c.id, "benched") },
                { label: "Kick", onClick: () => setStanding(c.id, "none") },
              ]}
            />
          ))}
        </div>

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
          className={`w-full ${pillSolid}`}
        >
          + New Character
        </button>
      </div>
    </main>
  );
}
