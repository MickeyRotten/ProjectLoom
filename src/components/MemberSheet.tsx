import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { EditImageButton } from "./EditImageButton";
import { TextField, AreaField, ReadBlock, EditToolbar, btn, btnSmall } from "./fields";
import { AutoUpdateModal } from "./AutoUpdateModal";
import { useEditBuffer } from "./useEditBuffer";
import { portraitKey } from "../lib/images";
import { getEntry, hasOverrides, partyFull as isPartyFull, resolve } from "../lib/roster";
import type { Character, CharacterStatus, Equipment } from "../types";

/** Player-settable standings, in the order they appear on the sheet. */
const STATUSES: CharacterStatus[] = ["active", "departed", "fallen"];

/** The character fields that are player-editable on this sheet. */
type MemberDraft = Pick<
  Character,
  | "name"
  | "species"
  | "description"
  | "personality"
  | "drive"
  | "strengths"
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
  const base = useStore((s) => s.characters.find((c) => c.id === id));
  const roster = useStore((s) => s.game.roster);
  const update = useStore((s) => s.updateCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const setInParty = useStore((s) => s.setInParty);
  const setStatus = useStore((s) => s.setStatus);
  const revertOverrides = useStore((s) => s.revertOverrides);
  const partyFull = isPartyFull(roster);
  const ensurePortrait = useStore((s) => s.ensurePortrait);
  const regeneratePortrait = useStore((s) => s.regeneratePortrait);
  const editPortrait = useStore((s) => s.editPortrait);
  const uploadPortrait = useStore((s) => s.uploadPortrait);
  const downloadPortrait = useStore((s) => s.downloadPortrait);
  const portraitUrl = useStore((s) => (id ? s.images[portraitKey(id)] : undefined));
  const portraitPending = useStore((s) => (id ? s.imgPending[portraitKey(id)] : false));
  const imageFailed = useStore((s) => (id ? s.imgError[portraitKey(id)] : false));
  const [zoom, setZoom] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const portraitFile = useRef<HTMLInputElement>(null);

  // The sheet shows the character AS THEY ARE THIS ADVENTURE — the authored
  // character with any story-written override folded on top.
  const member = useMemo(
    () => (base ? resolve(base, getEntry(roster, base.id)) : undefined),
    [base, roster],
  );
  const storyChanged = !!base && hasOverrides(roster, base.id);

  const source = useMemo<MemberDraft>(
    () => ({
      name: member?.name ?? "",
      species: member?.species ?? "",
      description: member?.description ?? "",
      personality: member?.personality ?? "",
      drive: member?.drive ?? "",
      strengths: member?.strengths ?? { name: "", description: "" },
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
        <OverlayHeader title="Character" />
        <p className="p-3 uppercase tracking-widest">No such character.</p>
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
      <OverlayHeader title={member.name || "Character"} />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <div className="relative mx-auto aspect-[2/3] w-full max-w-xs border-2 border-ink">
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
          {imageFailed && !portraitPending && (
            <span className="absolute bottom-1 right-1 border-2 border-ink bg-paper px-1 text-[0.6rem] uppercase tracking-widest">
              image failed
            </span>
          )}
        </div>

        {/* Custom art in / stored art out. Upload replaces the cached portrait
            (⟳ still regenerates over it); download hands the blob to the share
            sheet on mobile, a file download on desktop. */}
        <div className="flex gap-2">
          <input
            ref={portraitFile}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPortrait(member.id, file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={portraitPending}
            onClick={() => portraitFile.current?.click()}
            className={`flex-1 ${btnSmall}`}
          >
            Upload Image
          </button>
          <button
            type="button"
            disabled={!portraitUrl || portraitPending}
            onClick={() => void downloadPortrait(member.id)}
            className={`flex-1 ${btnSmall}`}
          >
            Download Image
          </button>
        </div>

        <EditToolbar editing={editing} onEdit={startEdit} onSave={save} onDiscard={discard} />

        {/* Gated behind read mode — an open draft would overwrite whatever the
            model just wrote the moment the player hits Save Changes. */}
        {!editing && (
          <button type="button" onClick={() => setAutoUpdate(true)} className={`w-full ${btn}`}>
            Auto-Update
          </button>
        )}

        {/* The story (a narrator delta or Auto-Update) has rewritten fields for
            THIS adventure only; the authored character is untouched. Saving an
            edit adopts the change, this button throws it away. */}
        {storyChanged && !editing && (
          <div className="space-y-2 border-2 border-ink p-3">
            <p className="text-sm uppercase tracking-widest opacity-70">
              Changed this adventure
            </p>
            <button
              type="button"
              onClick={() => revertOverrides(member.id)}
              className={`w-full ${btnSmall}`}
            >
              Revert Story Changes
            </button>
          </div>
        )}

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
          label="Appearance"
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

        <fieldset className="space-y-3 border-2 border-ink p-3">
          <legend className="px-1 uppercase tracking-widest text-sm">Strengths</legend>
          <TextField
            label="Name"
            value={v.strengths.name}
            editing={editing}
            onChange={(x) => setField("strengths", { ...v.strengths, name: x })}
          />
          <AreaField
            label="Description"
            value={v.strengths.description}
            editing={editing}
            rows={2}
            onChange={(x) => setField("strengths", { ...v.strengths, description: x })}
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
          <div className="space-y-4 border-t-2 border-ink pt-4">
            <fieldset className="space-y-2">
              <legend className="text-sm uppercase tracking-widest opacity-70">
                Standing this adventure
              </legend>
              <div className="flex gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={member.status === s}
                    onClick={() => setStatus(member.id, s)}
                    className={`flex-1 border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest ${
                      member.status === s ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              {/* Kicking ends party membership only — they stay in Characters,
                  with their portrait and sheet, and can be added back later. */}
              <button
                type="button"
                disabled={!member.inParty && partyFull}
                onClick={() => setInParty(member.id, !member.inParty)}
                className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
              >
                {member.inParty
                  ? "Kick from Party"
                  : partyFull
                    ? "Party Full"
                    : "Add to Party"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${member.name || "this character"} from Characters? They are removed from every adventure, along with their portrait. This can't be undone.`,
                    )
                  ) {
                    removeCharacter(member.id);
                  }
                }}
                className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
              >
                Delete Character
              </button>
            </div>
          </div>
        )}
      </div>

      {autoUpdate && (
        <AutoUpdateModal
          memberId={member.id}
          memberName={member.name}
          onClose={() => setAutoUpdate(false)}
        />
      )}

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
