import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { EditImageButton } from "./EditImageButton";
import { TextField, AreaField, ReadBlock, EditToolbar, btn, btnSmall } from "./fields";
import { AutoUpdateModal } from "./AutoUpdateModal";
import { GenerateFieldModal } from "./GenerateFieldModal";
import { GEN_FIELD_LABEL, type GenField } from "../lib/generateField";
import { useEditBuffer } from "./useEditBuffer";
import { useConfirm } from "./useConfirm";
import { portraitKey } from "../lib/images";
import {
  getEntry,
  hasOverrides,
  isInParty,
  partyFull as isPartyFull,
  resolve,
} from "../lib/roster";
import type { Character, Equipment, Standing } from "../types";

/**
 * Player-settable standings, in the order they appear on the sheet. "none" is
 * not here — it is what Kick does, and a radio labelled "none" reads like a
 * state rather than the act of dropping someone.
 */
const STANDINGS: { value: Standing; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "benched", label: "Benched" },
  { value: "npc", label: "NPC" },
  { value: "departed", label: "Departed" },
  { value: "fallen", label: "Fallen" },
];

/** What each standing means for the story, said plainly under the control. */
const STANDING_HINT: Record<Standing, string> = {
  active: "Travelling with you and in the scene. Can speak this turn.",
  benched: "One of yours, waiting elsewhere. Never voiced while benched.",
  npc: "Known to this world but not a companion. Appears where the scene reaches them.",
  departed: "Left the story. The narrator is told not to write them in.",
  fallen: "Dead. The narrator will never bring them back.",
  none: "Not part of this adventure. Still in Characters, and in every other save.",
};

/** The character fields that are player-editable on this sheet. */
type MemberDraft = Pick<
  Character,
  | "name"
  | "species"
  | "sex"
  | "description"
  | "personality"
  | "drive"
  | "strengths"
  | "flaws"
  | "equipment"
  | "useCustomPortraitPrompt"
  | "customPortraitPrompt"
>;

/**
 * Full-screen member sheet (DESIGN.md → Secondary screens): info · edit fields ·
 * regenerate / upload / remove portrait. Field editing is gated behind Edit mode — fields render as
 * read-only text blocks until the player toggles Edit, and changes live in a local
 * draft until Save Changes. Discard Changes (or leaving the screen) reverts and
 * exits edit mode. Portrait / enlist / delete actions stay available either way.
 * Opening the sheet ensures a portrait exists (unless the player removed it);
 * ⟳ force-regenerates it.
 */
export function MemberSheet() {
  const id = useStore((s) => s.memberId);
  const characters = useStore((s) => s.characters);
  const base = characters.find((c) => c.id === id);
  const roster = useStore((s) => s.game.roster);
  const update = useStore((s) => s.updateCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const setStanding = useStore((s) => s.setStanding);
  const setCondition = useStore((s) => s.setCondition);
  const revertOverrides = useStore((s) => s.revertOverrides);
  const partyFull = isPartyFull(characters, roster);
  const ensurePortrait = useStore((s) => s.ensurePortrait);
  const regeneratePortrait = useStore((s) => s.regeneratePortrait);
  const editPortrait = useStore((s) => s.editPortrait);
  const uploadPortrait = useStore((s) => s.uploadPortrait);
  const removePortrait = useStore((s) => s.removePortrait);
  const downloadPortrait = useStore((s) => s.downloadPortrait);
  const portraitUrl = useStore((s) => (id ? s.images[portraitKey(id)] : undefined));
  const portraitPending = useStore((s) => (id ? s.imgPending[portraitKey(id)] : false));
  const imageError = useStore((s) => (id ? s.imgError[portraitKey(id)] : undefined));
  const [zoom, setZoom] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [genField, setGenField] = useState<GenField | null>(null);
  const portraitFile = useRef<HTMLInputElement>(null);
  // Saving hands off to the OS (share sheet / download) and leaves no trace in
  // the app, so the sheet says what happened for a few seconds. `at` makes each
  // note a fresh object, so a second save restarts the timer.
  const [saveNote, setSaveNote] = useState<{ text: string; at: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const { ask, dialog } = useConfirm();

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
      sex: member?.sex ?? "",
      description: member?.description ?? "",
      personality: member?.personality ?? "",
      drive: member?.drive ?? "",
      strengths: member?.strengths ?? "",
      flaws: member?.flaws ?? "",
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

  useEffect(() => {
    if (!saveNote) return;
    const t = setTimeout(() => setSaveNote(null), 4000);
    return () => clearTimeout(t);
  }, [saveNote]);

  async function savePortrait(memberId: string) {
    setSaving(true);
    try {
      const ok = await downloadPortrait(memberId);
      setSaveNote({ text: ok ? "Image saved" : "Couldn't save image", at: Date.now() });
    } finally {
      setSaving(false);
    }
  }

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

  // ✦ only while editing: an accepted generation lands in the DRAFT, which is
  // what makes Discard Changes the undo. Offering it in read mode would mean
  // writing the character behind the Edit gate's back — the same hazard the
  // Auto-Update button above is gated for.
  //
  // ✦ and not ✨: the sparkle is an emoji and browsers paint it in colour, which
  // is one more colour than this app has. Same reason ⟳ and ✎ are the glyphs on
  // the portrait buttons.
  const genButton = (field: GenField) =>
    editing ? (
      <button
        type="button"
        aria-label={`Generate ${GEN_FIELD_LABEL[field]}`}
        onClick={() => setGenField(field)}
        className="border-2 border-ink px-2 py-1 leading-none active:bg-ink active:text-paper"
      >
        ✦
      </button>
    ) : undefined;

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
          {imageError && !portraitPending && (
            <span className="absolute bottom-1 right-1 border-2 border-ink bg-paper px-1 text-[0.6rem] uppercase tracking-widest">
              image failed
            </span>
          )}
        </div>

        {/* The reason, not just the fact: "image failed" alone gives the player
            nothing to act on, and the causes are wildly different (no credit, a
            refused prompt, a file the browser can't read). */}
        {imageError && !portraitPending && (
          <p className="text-center text-[0.65rem] uppercase tracking-widest" aria-live="polite">
            {imageError}
          </p>
        )}

        {/* Custom art in / stored art out / no art at all. Upload replaces the
            cached portrait (⟳ still regenerates over it); download hands the
            blob to the share sheet on mobile, a file download on desktop;
            remove deletes it and stops the automatic redraw. */}
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
            disabled={!portraitUrl || portraitPending || saving}
            onClick={() => void savePortrait(member.id)}
            className={`flex-1 ${btnSmall}`}
          >
            {saving ? "Saving…" : "Download Image"}
          </button>
        </div>
        <button
          type="button"
          disabled={!portraitUrl || portraitPending}
          onClick={() =>
            ask(
              {
                title: `Remove ${member.name || "this character"}'s image?`,
                body: "The picture is deleted and none is drawn automatically until you regenerate or upload one.",
                confirmLabel: "Remove image",
              },
              () => removePortrait(member.id),
            )
          }
          className={`w-full ${btnSmall}`}
        >
          Remove Image
        </button>
        {saveNote && (
          <p className="text-center text-[0.65rem] uppercase tracking-widest" aria-live="polite">
            {saveNote.text}
          </p>
        )}

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
          {/* Free text, like Species — the setting owns the vocabulary. Read by
              the narrator for pronouns and by the portrait prompt. */}
          <TextField
            label="Sex"
            value={v.sex}
            editing={editing}
            placeholder="male / female / …"
            onChange={(x) => setField("sex", x)}
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
          action={genButton("description")}
          onChange={(x) => setField("description", x)}
        />
        <AreaField
          label="Personality"
          value={v.personality}
          editing={editing}
          rows={2}
          action={genButton("personality")}
          onChange={(x) => setField("personality", x)}
        />
        <TextField
          label="Drive"
          value={v.drive}
          editing={editing}
          action={genButton("drive")}
          onChange={(x) => setField("drive", x)}
        />

        <AreaField
          label="Strengths"
          value={v.strengths}
          editing={editing}
          rows={2}
          action={genButton("strengths")}
          onChange={(x) => setField("strengths", x)}
        />
        <AreaField
          label="Flaws"
          value={v.flaws}
          editing={editing}
          rows={2}
          action={genButton("flaws")}
          onChange={(x) => setField("flaws", x)}
        />

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

        {/* Condition — this adventure's mark, not part of the frozen sheet, so
            it sits outside the Edit gate and outside the member-only block: a
            costly outcome lands on the player more often than on anyone else. */}
        <div className="space-y-2 border-t-2 border-ink pt-4">
          <label className="block space-y-1">
            <span className="block text-sm uppercase tracking-widest opacity-70">
              Condition this adventure
            </span>
            <textarea
              value={member.condition}
              rows={2}
              placeholder="unhurt"
              onChange={(e) => setCondition(member.id, e.target.value)}
              className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
            />
          </label>
          <p className="text-xs opacity-60">
            What the story has done to them — a wound, a debt, someone hunting them.
            The narrator reads it every turn and clears it when it's resolved. Blank
            means unmarked, and it never touches their sheet.
          </p>
        </div>

        {member.role === "member" && (
          <div className="space-y-4 border-t-2 border-ink pt-4">
            <fieldset className="space-y-2">
              <legend className="text-sm uppercase tracking-widest opacity-70">
                Standing this adventure
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {STANDINGS.map(({ value, label }) => {
                  const current = member.standing === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={current}
                      // Only the scene is capped — every other standing is
                      // always reachable, including stepping out of the party.
                      disabled={!current && value === "active" && partyFull}
                      onClick={() => setStanding(member.id, value)}
                      className={`border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest disabled:opacity-40 ${
                        current ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs opacity-60">{STANDING_HINT[member.standing]}</p>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              {/* Kicking drops them out of the party and nothing more — they
                  stay in Characters with their portrait and sheet, the story is
                  told nothing about it, and they can be added back later. */}
              {isInParty(member.standing) ? (
                <button
                  type="button"
                  onClick={() => setStanding(member.id, "none")}
                  className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
                >
                  Kick from Party
                </button>
              ) : (
                <button
                  type="button"
                  disabled={partyFull}
                  onClick={() => setStanding(member.id, "active")}
                  className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
                >
                  {partyFull ? "Party Full" : "Add to Party"}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: `Delete ${member.name || "this character"}?`,
                      body: "They are removed from Characters and from every adventure, along with their portrait. This can't be undone.",
                      confirmLabel: "Delete character",
                    },
                    () => removeCharacter(member.id),
                  )
                }
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

      {/* Fed the DRAFT, not the saved character: a Flaws generated right after
          the player typed a Personality has to read that Personality. */}
      {genField && (
        <GenerateFieldModal
          character={{ ...member, ...v }}
          field={genField}
          onAccept={(text) => setField(genField, text)}
          onClose={() => setGenField(null)}
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
      {dialog}
    </main>
  );
}
