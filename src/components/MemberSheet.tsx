import { useEffect, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { EditImageButton } from "./EditImageButton";
import { portraitKey } from "../lib/images";
import { PARTY_LIMIT } from "../lib/defaults";
import type { Equipment } from "../types";

/**
 * Full-screen member sheet (DESIGN.md → Secondary screens): info · inline edit
 * fields · regenerate portrait. Everything is editable in place — no Edit mode.
 * Opening the sheet ensures a portrait exists; ⟳ force-regenerates it.
 */
export function MemberSheet() {
  const id = useStore((s) => s.memberId);
  const member = useStore((s) => s.game.characters.find((c) => c.id === id));
  const update = useStore((s) => s.updateCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const setInParty = useStore((s) => s.setInParty);
  const partyFull = useStore(
    (s) => s.game.characters.filter((c) => c.role === "member" && c.inParty).length >= PARTY_LIMIT,
  );
  const setScreen = useStore((s) => s.setScreen);
  const ensurePortrait = useStore((s) => s.ensurePortrait);
  const regeneratePortrait = useStore((s) => s.regeneratePortrait);
  const editPortrait = useStore((s) => s.editPortrait);
  const portraitUrl = useStore((s) => (id ? s.images[portraitKey(id)] : undefined));
  const portraitPending = useStore((s) => (id ? s.imgPending[portraitKey(id)] : false));
  const editFailed = useStore((s) => (id ? s.imgError[portraitKey(id)] : false));
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (id) ensurePortrait(id);
  }, [id, ensurePortrait]);

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
        <div className="relative mx-auto aspect-[3/4] w-full max-w-xs border-2 border-ink">
          {portraitUrl ? (
            <button
              type="button"
              aria-label="View portrait full screen"
              onClick={() => setZoom(true)}
              className="block h-full w-full active:opacity-60"
            >
              <img
                src={portraitUrl}
                alt={member.name}
                className="h-full w-full object-cover [image-rendering:pixelated]"
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-3xl font-bold uppercase tracking-widest opacity-50">
              {portraitPending ? (
                <span className="text-base tracking-widest">rendering portrait…</span>
              ) : (
                (member.name[0] ?? "?").toUpperCase()
              )}
            </div>
          )}
          <button
            type="button"
            aria-label="Regenerate portrait"
            disabled={portraitPending}
            onClick={() => regeneratePortrait(member.id)}
            className="absolute right-1 top-1 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
          >
            ⟳
          </button>
          {portraitUrl && (
            <EditImageButton
              label="Edit portrait"
              disabled={portraitPending}
              onSubmit={(instruction) => editPortrait(member.id, instruction)}
              className="absolute right-9 top-1 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
            />
          )}
          {editFailed && !portraitPending && (
            <span className="absolute bottom-1 right-1 border-2 border-ink bg-paper px-1 text-[0.6rem] uppercase tracking-widest">
              edit failed
            </span>
          )}
        </div>

        <div className="space-y-4">
          <Text label="Name" value={member.name} onChange={(v) => update(member.id, { name: v })} />
          <Text label="Species" value={member.species} onChange={(v) => update(member.id, { species: v })} />
        </div>

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Portrait Prompt</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={member.useCustomPortraitPrompt ?? false}
              onChange={(e) => update(member.id, { useCustomPortraitPrompt: e.target.checked })}
              className="h-4 w-4 accent-ink"
            />
            <span className="uppercase tracking-widest text-sm">Custom image prompt</span>
          </label>
          {member.useCustomPortraitPrompt && (
            <Area
              label="Prompt (overrides default)"
              value={member.customPortraitPrompt ?? ""}
              onChange={(v) => update(member.id, { customPortraitPrompt: v })}
            />
          )}
        </fieldset>

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

        {member.role === "member" && (
          <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-4">
            <button
              type="button"
              disabled={!member.inParty && partyFull}
              onClick={() => setInParty(member.id, !member.inParty)}
              className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
            >
              {member.inParty ? "Bench Member" : partyFull ? "Party Full" : "Enlist Member"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete ${member.name || "this member"}? This can't be undone.`)) {
                  removeCharacter(member.id);
                }
              }}
              className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
            >
              Delete Member
            </button>
          </div>
        )}
      </div>

      {zoom && portraitUrl && (
        <button
          type="button"
          aria-label="Close full-screen portrait"
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3"
        >
          <img
            src={portraitUrl}
            alt={member.name}
            className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
          />
        </button>
      )}
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
