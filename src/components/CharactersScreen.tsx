import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { btn } from "./fields";

/**
 * Characters (DESIGN.md → Menu): PC + party CRUD. Rows open the shared member
 * sheet for inline editing; "+ Add Member" seeds a blank in-party member. The
 * PC is always present and can't be removed (handled in the sheet + store).
 */
export function CharactersScreen() {
  const characters = useStore((s) => s.game.characters);
  const openMember = useStore((s) => s.openMember);
  const addMember = useStore((s) => s.addMember);

  const pc = characters.filter((c) => c.role === "pc");
  const members = characters.filter((c) => c.role === "member");

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Characters" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {pc.map((c) => (
          <Row key={c.id} name={c.name || "(unnamed)"} sub="Player Character" onOpen={() => openMember(c.id)} />
        ))}

        {members.length > 0 && (
          <p className="pt-2 uppercase tracking-widest text-sm opacity-60">Party</p>
        )}
        {members.map((c) => (
          <Row
            key={c.id}
            name={c.name || "(unnamed)"}
            sub={`${c.species}${c.inParty ? "" : " · benched"}`}
            onOpen={() => openMember(c.id)}
          />
        ))}

        <button type="button" onClick={() => openMember(addMember())} className={`w-full ${btn}`}>
          + Add Member
        </button>
      </div>
    </main>
  );
}

function Row({ name, sub, onOpen }: { name: string; sub: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full border-2 border-ink p-3 text-left active:bg-ink active:text-paper"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold uppercase tracking-wide">{name}</span>
        <span className="text-sm opacity-70">{sub}</span>
      </div>
    </button>
  );
}
