import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { EditImageButton } from "./EditImageButton";
import { TextField, AreaField, ReadBlock, EditToolbar } from "./fields";
import { useEditBuffer } from "./useEditBuffer";
import { portraitKey } from "../lib/images";
import { PARTY_LIMIT } from "../lib/defaults";
import type { Character, Equipment } from "../types";

/** The character fields that are player-editable on this sheet. */
type MemberDraft = Pick<
  Character,
  | "name"
  | "species"
  | "description"
  | "personality"
  | "drive"
  | "likes"
  | "dislikes"
  | "fieldSkill"
  | "equipment"
  | "useCustomPortraitPrompt"
  | "customPortraitPrompt"
>;

/**
 * Full-screen member sheet (DESIGN.md → Secondary screens): info · edit fields ·
 * regenerate portrait. Field editing is gated behind Edit mode — fields render as
 * read-only text blocks until the player toggles Edit, and changes live in a local
 * draft until Save Changes. Discard Changes (or leaving the screen) reverts and
 * exits edit mode. Portrait / enlist / delete actions stay available either way.
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
  const ensurePortrait = useStore((s) => s.ensurePortrait);
  const regeneratePortrait = useStore((s) => s.regeneratePortrait);
  const editPortrait = useStore((s) => s.editPortrait);
  const portraitUrl = useStore((s) => (id ? s.images[portraitKey(id)] : undefined));
  const portraitPending = useStore((s) => (id ? s.imgPending[portraitKey(id)] : false));
  const editFailed = useStore((s) => (id ? s.imgError[portraitKey(id)] : false));
  const [zoom, setZoom] = useState(false);

  const source = useMemo<MemberDraft>(
    () => ({
      name: member?.name ?? "",
      species: member?.species ?? "",
      description: member?.description ?? "",
      personality: member?.personality ?? "",
      drive: member?.drive ?? "",
      likes: member?.likes ?? "",
      dislikes: member?.dislikes ?? "",
      fieldSkill: member?.fieldSkill ?? { name: "", description: "" },
      equipment: member?.equipment ?? [],
      useCustomPortraitPrompt: member?.useCustomPortraitPrompt ?? false,
      customPortraitPrompt: member?.customPortraitPrompt ?? "",
    }),
    [member],
  );

  const { editing, draft, setDraft, startEdit, save, discard } = useEditBuffer(source, (d) => {
    if (member) update(member.id, d);
  });

  useEffect(() => {
    if (id) ensurePortrait(id);
  }, [id, ensurePortrait]);

  if (!member) {
    return (
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
        <OverlayHeader title="Member" />
        <p className="p-3 uppercase tracking-widest">No such member.</p>
      </main>
    );
  }

  // Read view renders from the live character; edit view from the draft buffer.
  const v = editing ? draft : source;

  function setField<K extends keyof MemberDraft>(k: K, val: MemberDraft[K]) {
    setDraft((d) => ({ ...d, [k]: val }));
  }
  const setEquip = (next: Equipment[]) => setField("equipment", next);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title={member.name || "Member"} />

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

        <EditToolbar editing={editing} onEdit={startEdit} onSave={save} onDiscard={discard} />

        <div className="space-y-4">
          <TextField label="Name" value={v.name} editing={editing} onChange={(x) => setField("name", x)} />
          <TextField
            label="Species"
            value={v.species}
            editing={editing}
            onChange={(x) => setField("species", x)}
          />
        </div>

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Portrait Prompt</legend>
          {editing ? (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.useCustomPortraitPrompt ?? false}
                  onChange={(e) => setField("useCustomPortraitPrompt", e.target.checked)}
                  className="h-4 w-4 accent-ink"
                />
                <span className="uppercase tracking-widest text-sm">Custom image prompt</span>
              </label>
              {v.useCustomPortraitPrompt && (
                <AreaField
                  label="Prompt (overrides default)"
                  value={v.customPortraitPrompt ?? ""}
                  editing={editing}
                  onChange={(x) => setField("customPortraitPrompt", x)}
                />
              )}
            </>
          ) : v.useCustomPortraitPrompt ? (
            <ReadBlock label="Custom image prompt" value={v.customPortraitPrompt ?? ""} />
          ) : (
            <p className="uppercase tracking-widest text-sm opacity-60">Default prompt</p>
          )}
        </fieldset>

        <AreaField
          label="Description"
          value={v.description}
          editing={editing}
          rows={2}
          onChange={(x) => setField("description", x)}
        />
        <AreaField
          label="Personality"
          value={v.personality}
          editing={editing}
          rows={2}
          onChange={(x) => setField("personality", x)}
        />
        <TextField label="Drive" value={v.drive} editing={editing} onChange={(x) => setField("drive", x)} />
        <TextField label="Likes" value={v.likes} editing={editing} onChange={(x) => setField("likes", x)} />
        <TextField
          label="Dislikes"
          value={v.dislikes}
          editing={editing}
          onChange={(x) => setField("dislikes", x)}
        />

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Field Skill</legend>
          <TextField
            label="Name"
            value={v.fieldSkill.name}
            editing={editing}
            onChange={(x) => setField("fieldSkill", { ...v.fieldSkill, name: x })}
          />
          <AreaField
            label="Description"
            value={v.fieldSkill.description}
            editing={editing}
            rows={2}
            onChange={(x) => setField("fieldSkill", { ...v.fieldSkill, description: x })}
          />
        </fieldset>

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Equipment</legend>
          {v.equipment.length === 0 && !editing && (
            <p className="uppercase tracking-widest text-sm opacity-60">None.</p>
          )}
          {v.equipment.map((e, i) => (
            <div key={i} className="space-y-2 border-b-2 border-ink pb-3 last:border-b-0 last:pb-0">
              <TextField
                label="Label"
                value={e.label}
                editing={editing}
                onChange={(x) => setEquip(v.equipment.map((y, j) => (j === i ? { ...y, label: x } : y)))}
              />
              <TextField
                label="Description"
                value={e.description}
                editing={editing}
                onChange={(x) =>
                  setEquip(v.equipment.map((y, j) => (j === i ? { ...y, description: x } : y)))
                }
              />
              {editing && (
                <button
                  type="button"
                  onClick={() => setEquip(v.equipment.filter((_, j) => j !== i))}
                  className="border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {editing && (
            <button
              type="button"
              onClick={() => setEquip([...v.equipment, { label: "", description: "" }])}
              className="w-full border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
            >
              + Add Equipment
            </button>
          )}
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
