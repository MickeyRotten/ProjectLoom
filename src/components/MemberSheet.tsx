import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import type { Equipment } from "../types";

/**
 * Full-screen member sheet (DESIGN.md → Secondary screens): info · inline edit
 * fields · regenerate portrait. Everything is editable in place — no Edit
 * mode. Portrait generation lands in Phase 3, so the button is a placeholder.
 */
export function MemberSheet() {
  const id = useStore((s) => s.memberId);
  const member = useStore((s) => s.game.characters.find((c) => c.id === id));
  const update = useStore((s) => s.updateCharacter);
  const setScreen = useStore((s) => s.setScreen);

  if (!member) {
    return (
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
        <OverlayHeader title="Member" onBack={() => setScreen(null)} />
        <p className="p-3 uppercase tracking-widest">No such member.</p>
      </main>
    );
  }

  const setEquip = (next: Equipment[]) => update(member.id, { equipment: next });

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={member.name || "Member"} onBack={() => setScreen(null)} />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-16 w-16 items-center justify-center border-2 border-ink text-lg font-bold">
            {(member.name[0] ?? "?").toUpperCase()}
          </span>
          <button
            type="button"
            disabled
            title="Portrait generation arrives in Phase 3"
            className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest opacity-40"
          >
            Regen Portrait
          </button>
        </div>

        <Text label="Name" value={member.name} onChange={(v) => update(member.id, { name: v })} />
        <Text label="Species" value={member.species} onChange={(v) => update(member.id, { species: v })} />
        <Area label="Description" value={member.description} onChange={(v) => update(member.id, { description: v })} />
        <Area label="Personality" value={member.personality} onChange={(v) => update(member.id, { personality: v })} />
        <Text label="Drive" value={member.drive} onChange={(v) => update(member.id, { drive: v })} />
        <Text label="Likes" value={member.likes} onChange={(v) => update(member.id, { likes: v })} />
        <Text label="Dislikes" value={member.dislikes} onChange={(v) => update(member.id, { dislikes: v })} />

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Field Skill</legend>
          <Text
            label="Name"
            value={member.fieldSkill.name}
            onChange={(v) => update(member.id, { fieldSkill: { ...member.fieldSkill, name: v } })}
          />
          <Area
            label="Description"
            value={member.fieldSkill.description}
            onChange={(v) => update(member.id, { fieldSkill: { ...member.fieldSkill, description: v } })}
          />
        </fieldset>

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Equipment</legend>
          {member.equipment.map((e, i) => (
            <div key={i} className="space-y-2 border-b-2 border-ink pb-3 last:border-b-0 last:pb-0">
              <Text
                label="Label"
                value={e.label}
                onChange={(v) => setEquip(member.equipment.map((x, j) => (j === i ? { ...x, label: v } : x)))}
              />
              <Text
                label="Description"
                value={e.description}
                onChange={(v) => setEquip(member.equipment.map((x, j) => (j === i ? { ...x, description: v } : x)))}
              />
              <button
                type="button"
                onClick={() => setEquip(member.equipment.filter((_, j) => j !== i))}
                className="border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEquip([...member.equipment, { label: "", description: "" }])}
            className="w-full border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
          >
            + Add Equipment
          </button>
        </fieldset>
      </div>
    </main>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="block uppercase tracking-widest text-sm">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
      />
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="block uppercase tracking-widest text-sm">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
      />
    </label>
  );
}
