import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { AreaField, Collapsible, ReadBlock } from "./fields";
import {
  MaterialHeader,
  EditPencilButton,
  Chip,
  card,
  fieldLabel,
  filledInput,
  filledTextarea,
  pillSolid,
  pillOutline,
} from "./material";
import { AutoUpdateModal } from "./AutoUpdateModal";
import { GenerateFieldModal } from "./GenerateFieldModal";
import { GenerateItemModal } from "./GenerateItemModal";
import { useEditBuffer } from "./useEditBuffer";
import { useConfirm } from "./useConfirm";
import { imagesAllowed, portraitKey } from "../lib/images";
import { parseAliases } from "../lib/names";
import { makeItemBlock, makeTextBlock, moveBlock } from "../lib/blocks";
import {
  getEntry,
  hasOverrides,
  isInParty,
  partyFull as isPartyFull,
  resolve,
} from "../lib/roster";
import {
  ATTRIBUTE_LABELS,
  MAX_ATTRIBUTE,
  MIN_ATTRIBUTE,
  characterAttributes,
  characterSpecialisations,
} from "../lib/attributes";
import { ATTRIBUTES } from "../types";
import type {
  Attribute,
  Attributes,
  Block,
  BlockKind,
  Character,
  ItemBlock,
  Specialisation,
  Standing,
} from "../types";

/** Starting-pick cap: up to this many held Specialisations per Attribute. */
const MAX_SPECS_PER_ATTRIBUTE = 3;

function AttributesEditor({
  value,
  editing,
  onChange,
}: {
  value: Attributes;
  editing: boolean;
  onChange: (next: Attributes) => void;
}) {
  if (!editing) {
    const scores = ATTRIBUTES.map((a) => `${ATTRIBUTE_LABELS[a]} ${value[a] >= 0 ? "+" : ""}${value[a]}`);
    return <ReadBlock label="Attributes" value={scores.join(" · ")} />;
  }
  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>Attributes</span>
      <div className="grid grid-cols-2 gap-2">
        {ATTRIBUTES.map((a) => (
          <label key={a} className="flex items-center justify-between gap-2 rounded-[10px] bg-[var(--m-surface-strong)] px-3 py-2">
            <span className="text-[13px]">{ATTRIBUTE_LABELS[a]}</span>
            <input
              type="number"
              min={MIN_ATTRIBUTE}
              max={MAX_ATTRIBUTE}
              value={value[a]}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isFinite(n)) return;
                onChange({ ...value, [a]: Math.min(MAX_ATTRIBUTE, Math.max(MIN_ATTRIBUTE, Math.round(n))) });
              }}
              className="w-12 rounded-[8px] border-none bg-paper px-1 py-1 text-center tabular-nums text-ink outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SpecialisationsEditor({
  catalog,
  held,
  editing,
  onChange,
}: {
  catalog: Specialisation[];
  held: string[];
  editing: boolean;
  onChange: (next: string[]) => void;
}) {
  if (!editing) {
    const labels = held.map((id) => catalog.find((s) => s.id === id)?.label).filter(Boolean);
    return <ReadBlock label="Specialisations" value={labels.join(", ")} />;
  }
  const countFor = (a: Attribute) =>
    catalog.filter((s) => s.attribute === a && held.includes(s.id)).length;
  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>Specialisations (up to {MAX_SPECS_PER_ATTRIBUTE} per Attribute)</span>
      <div className="space-y-2">
        {ATTRIBUTES.map((a) => (
          <div key={a} className="space-y-1">
            <span className="text-xs uppercase tracking-widest text-[var(--m-text-55)]">
              {ATTRIBUTE_LABELS[a]}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {catalog
                .filter((s) => s.attribute === a)
                .map((s) => {
                  const checked = held.includes(s.id);
                  const atCap = !checked && countFor(a) >= MAX_SPECS_PER_ATTRIBUTE;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={atCap}
                      aria-pressed={checked}
                      onClick={() =>
                        onChange(checked ? held.filter((id) => id !== s.id) : [...held, s.id])
                      }
                      className={`min-h-9 rounded-full border px-3 py-1 text-[13px] disabled:opacity-40 ${
                        checked
                          ? "border-transparent bg-ink text-paper"
                          : "border-[var(--m-outline-soft)] bg-transparent text-ink"
                      }`}
                    >
                      {s.label || "(unnamed)"}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Every block kind, in the order the dropdown offers it. */
const BLOCK_KINDS: BlockKind[] = [
  "custom",
  "appearance",
  "personality",
  "drive",
  "strengths",
  "flaws",
  "notes",
];

const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  custom: "Custom",
  appearance: "Appearance",
  personality: "Personality",
  drive: "Drive",
  strengths: "Strengths",
  flaws: "Flaws",
  notes: "Notes",
};

/**
 * One block on the sheet — Text or Item. Read mode is the mock-up's plain
 * label/text pair (a "Sheet" isn't a list of cards until you're changing it);
 * edit mode is the reorderable filled card every gated screen now shares.
 * `onUnequip` only fires for an Item block in READ mode: unequipping writes
 * two stores at once (the pack and the character), the same reason Condition
 * sits outside the Edit gate, so it bypasses the draft entirely.
 */
function BlockRow({
  block,
  index,
  count,
  editing,
  specCatalog,
  onChange,
  onMove,
  onToggle,
  onRemove,
  onGenerate,
  onUnequip,
}: {
  block: Block;
  index: number;
  count: number;
  editing: boolean;
  specCatalog: Specialisation[];
  onChange: (next: Block) => void;
  onMove: (dir: -1 | 1) => void;
  onToggle: () => void;
  onRemove: () => void;
  onGenerate: () => void;
  onUnequip?: () => void;
}) {
  const isItem = block.type === "item";

  if (!editing) {
    return (
      <div className={block.enabled ? "" : "opacity-50"}>
        <p className={fieldLabel}>
          {block.title || "(untitled)"}
          {!block.enabled && " — disabled"}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed">{block.text}</p>
        {isItem && block.quantity > 1 && (
          <p className="mt-0.5 text-[13px] tabular-nums text-[var(--m-text-55)]">
            × {block.quantity}
          </p>
        )}
        {isItem && onUnequip && (
          <button type="button" onClick={onUnequip} className={`mt-2 ${pillOutline}`}>
            Unequip
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${card}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <span className={fieldLabel}>{isItem ? "Label" : "Title"}</span>
          <input
            value={block.title}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            className={filledInput}
          />
        </div>
        {!isItem && (
          <select
            aria-label="Kind"
            value={block.kind}
            onChange={(e) => onChange({ ...block, kind: e.target.value as BlockKind })}
            className="rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-[11px] text-[13px] text-ink outline-none"
          >
            {BLOCK_KINDS.map((k) => (
              <option key={k} value={k}>
                {BLOCK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </div>

      <textarea
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
        rows={2}
        className={filledTextarea}
      />

      {isItem && (
        <label className="flex items-center gap-2">
          <span className={fieldLabel}>Qty</span>
          <input
            type="number"
            min={1}
            value={block.quantity}
            onChange={(e) =>
              onChange({ ...block, quantity: Math.max(1, Number(e.target.value) || 1) })
            }
            className="w-16 rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-2 text-center tabular-nums text-ink outline-none"
          />
        </label>
      )}

      {/* RPG System mechanics — purely player-set, never model-authored, the
          same reason `equip.ts → canEquip` already refuses Gold. */}
      {isItem && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={fieldLabel}>Attribute Bonus</span>
          <select
            aria-label="Attribute bonus target"
            value={block.attributeBonus?.attribute ?? ""}
            onChange={(e) => {
              const attribute = e.target.value as Attribute | "";
              onChange({
                ...block,
                attributeBonus: attribute
                  ? { attribute, amount: block.attributeBonus?.amount || 1 }
                  : undefined,
              });
            }}
            className="rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">None</option>
            {ATTRIBUTES.map((a) => (
              <option key={a} value={a}>
                {ATTRIBUTE_LABELS[a]}
              </option>
            ))}
          </select>
          {block.attributeBonus && (
            <input
              type="number"
              min={0}
              max={MAX_ATTRIBUTE}
              value={block.attributeBonus.amount}
              onChange={(e) =>
                onChange({
                  ...block,
                  attributeBonus: {
                    attribute: block.attributeBonus!.attribute,
                    amount: Math.min(MAX_ATTRIBUTE, Math.max(0, Number(e.target.value) || 0)),
                  },
                })
              }
              className="w-14 rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-2 text-center tabular-nums text-ink outline-none"
            />
          )}
        </div>
      )}
      {isItem && (
        <label className="flex items-center gap-2">
          <span className={fieldLabel}>Grants Specialisation</span>
          <select
            value={block.grantedSpecialisation ?? ""}
            onChange={(e) =>
              onChange({ ...block, grantedSpecialisation: e.target.value || undefined })
            }
            className="flex-1 rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">None</option>
            {specCatalog.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {block.kind === "notes" && (
        <p className="text-xs text-[var(--m-text-55)]">
          Yours to write. The narrator reads it, but never writes it — no story
          beat, Auto-Update or ✦ generation can touch it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={onToggle} className={pillOutline}>
          {block.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          aria-label="Move block up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className={`${pillOutline} !min-h-9 !px-3`}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="Move block down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className={`${pillOutline} !min-h-9 !px-3`}
        >
          ▼
        </button>
        <button type="button" onClick={onRemove} className={pillOutline}>
          Remove
        </button>
        {/* No ✦ beside Notes — the point of it is text nothing generates. */}
        {block.kind !== "notes" && (
          <button
            type="button"
            aria-label={`Generate ${block.title.trim() || (isItem ? "item" : "block")}`}
            onClick={onGenerate}
            className={`${pillOutline} !min-h-9 !px-3`}
          >
            ✦
          </button>
        )}
      </div>
    </div>
  );
}

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
  none: "Not in the party and not an NPC. Still in this adventure's Characters.",
};

/** The character fields that are player-editable on this sheet. */
type MemberDraft = Pick<
  Character,
  | "name"
  | "aliases"
  | "species"
  | "sex"
  | "blocks"
  | "attributes"
  | "specialisations"
  | "useCustomPortraitPrompt"
  | "customPortraitPrompt"
>;

/**
 * Full-screen member sheet (DESIGN.md → Secondary screens) — Material
 * redesign (`Loom Material Redesign.dc.html`). Portrait → read/edit fields →
 * the sheet's blocks → Story → Condition → Standing → leave/delete, same
 * order as before; the header pencil now opens Edit (was a full-width button
 * above the fields) and Save/Discard now sit at the BOTTOM of the editable
 * content, matching the mock-up's pattern everywhere it gates editing.
 *
 * Field editing is gated behind Edit mode — fields render as read-only text
 * until the player toggles Edit, and changes live in a local draft until Save
 * Changes. Discard Changes (or leaving the screen) reverts and exits edit
 * mode. Portrait / enlist / delete actions stay available either way.
 */
export function MemberSheet() {
  const id = useStore((s) => s.memberId);
  const specCatalog = useStore((s) => s.settings.specialisations);
  const characters = useStore((s) => s.game.characters);
  const base = characters.find((c) => c.id === id);
  const roster = useStore((s) => s.game.roster);
  const update = useStore((s) => s.updateCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const setStanding = useStore((s) => s.setStanding);
  const setCondition = useStore((s) => s.setCondition);
  const unequip = useStore((s) => s.unequipItem);
  const revertOverrides = useStore((s) => s.revertOverrides);
  const partyFull = isPartyFull(characters, roster);
  const ensurePortrait = useStore((s) => s.ensurePortrait);
  const regeneratePortrait = useStore((s) => s.regeneratePortrait);
  const uploadPortrait = useStore((s) => s.uploadPortrait);
  const removePortrait = useStore((s) => s.removePortrait);
  const downloadPortrait = useStore((s) => s.downloadPortrait);
  const portraitUrl = useStore((s) => (id ? s.images[portraitKey(id)] : undefined));
  const portraitPending = useStore((s) => (id ? s.imgPending[portraitKey(id)] : false));
  const imageError = useStore((s) => (id ? s.imgError[portraitKey(id)] : undefined));
  const imagesOn = useStore((s) => imagesAllowed(s.settings));
  const [zoom, setZoom] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  // The block the model is writing — an id into the draft's block list, since
  // ✦ is only offered while editing.
  const [genBlockId, setGenBlockId] = useState<string | null>(null);
  const portraitFile = useRef<HTMLInputElement>(null);
  // The alias field is a list edited as one comma-separated line, so the raw
  // text has to survive parsing: reflecting the parsed list straight back would
  // eat the comma the moment it is typed.
  const [aliasText, setAliasText] = useState("");
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
      aliases: member?.aliases ?? [],
      species: member?.species ?? "",
      sex: member?.sex ?? "",
      blocks: member?.blocks ?? [],
      attributes: member ? characterAttributes(member) : characterAttributes({ attributes: undefined }),
      specialisations: member ? characterSpecialisations(member) : [],
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

  // Re-seed the raw alias line whenever the edit buffer opens or the character
  // changes — including after a save, so a rename's new alias shows up.
  useEffect(() => {
    if (!editing) setAliasText((source.aliases ?? []).join(", "));
  }, [editing, source.aliases]);

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
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
        <MaterialHeader title="Character" back />
        <p className="p-3 text-[var(--m-text-55)]">No such character.</p>
      </main>
    );
  }

  // Read view renders from the live character; edit view from the draft buffer.
  const v = editing ? draft : source;

  function setField<K extends keyof MemberDraft>(k: K, val: MemberDraft[K]) {
    setDraft((d) => ({ ...d, [k]: val }));
  }
  const setBlocks = (next: Block[]) => setField("blocks", next);
  const genBlock = genBlockId ? v.blocks.find((b) => b.id === genBlockId) : undefined;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader
        title={member.name || "Character"}
        back
        action={!editing && <EditPencilButton onClick={startEdit} />}
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        <div className="relative mx-auto aspect-[2/3] w-full max-w-xs overflow-hidden rounded-[16px] bg-[var(--m-avatar)]">
          {portraitUrl ? (
            <button
              type="button"
              aria-label="View portrait full screen"
              onClick={() => setZoom(true)}
              className="block h-full w-full active:opacity-80"
            >
              <img src={portraitUrl} alt={member.name} className="h-full w-full object-cover" />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-3xl font-bold">
              {portraitPending ? (
                <span className="text-base font-normal text-[var(--m-text-55)]">
                  rendering portrait…
                </span>
              ) : (
                (member.name[0] ?? "?").toUpperCase()
              )}
            </div>
          )}
          {/* ⟳ is a generation, so it goes with the master switch (Images →
              Image Generation). Upload / download / remove stay: none of them
              talks to a model. */}
          {imagesOn && (
            <button
              type="button"
              aria-label="Regenerate portrait"
              disabled={portraitPending}
              onClick={() => regeneratePortrait(member.id)}
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] text-paper disabled:opacity-40"
            >
              ⟳
            </button>
          )}
          {imageError && !portraitPending && (
            <span className="absolute bottom-2 right-2 rounded-full bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] px-2.5 py-1 text-[0.65rem] uppercase tracking-widest text-paper">
              image failed
            </span>
          )}
        </div>

        {/* The reason, not just the fact: "image failed" alone gives the player
            nothing to act on, and the causes are wildly different (no credit, a
            refused prompt, a file the browser can't read). */}
        {imageError && !portraitPending && (
          <p className="text-center text-[0.7rem] text-[var(--m-text-55)]" aria-live="polite">
            {imageError}
          </p>
        )}

        {/* Custom art in / stored art out / no art at all, folded away — out
            of the mock-up's scope, so it keeps fields.tsx's own look. */}
        <Collapsible label="Image Options">
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
              className="inline-flex min-h-11 flex-1 items-center justify-center border-2 border-ink px-3 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40"
            >
              Upload Image
            </button>
            <button
              type="button"
              disabled={!portraitUrl || portraitPending || saving}
              onClick={() => void savePortrait(member.id)}
              className="inline-flex min-h-11 flex-1 items-center justify-center border-2 border-ink px-3 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40"
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
            className="inline-flex min-h-11 w-full items-center justify-center border-2 border-ink px-3 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40"
          >
            Remove Image
          </button>
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
            <p className="uppercase tracking-widest text-sm opacity-60">
              Portrait prompt: default. Edit the sheet to override it.
            </p>
          )}
        </Collapsible>
        {saveNote && (
          <p className="text-center text-[0.7rem] text-[var(--m-text-55)]" aria-live="polite">
            {saveNote.text}
          </p>
        )}

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className={fieldLabel}>Name</span>
            {editing ? (
              <input
                value={v.name}
                onChange={(e) => setField("name", e.target.value)}
                className={filledInput}
              />
            ) : (
              <p className="text-[15px]">{v.name}</p>
            )}
          </label>

          {/* Former names. Written by a rename — the narrator's or the player's
              own edit above — and kept because the transcript, the journal and
              the next few narrator ops all still say them. */}
          {(editing || !!v.aliases?.length) && (
            <label className="block space-y-1">
              <span className={fieldLabel}>Also known as</span>
              {editing ? (
                <input
                  value={aliasText}
                  placeholder="former names, comma separated"
                  onChange={(e) => {
                    setAliasText(e.target.value);
                    setField("aliases", parseAliases(e.target.value, v.name));
                  }}
                  className={filledInput}
                />
              ) : (
                <p className="text-[15px]">{(v.aliases ?? []).join(", ")}</p>
              )}
            </label>
          )}

          <label className="block space-y-1">
            <span className={fieldLabel}>Species</span>
            {editing ? (
              <input
                value={v.species}
                onChange={(e) => setField("species", e.target.value)}
                className={filledInput}
              />
            ) : (
              <p className="text-[15px]">{v.species}</p>
            )}
          </label>

          {/* Free text, like Species — the setting owns the vocabulary. Read by
              the narrator for pronouns and by the portrait prompt. */}
          <label className="block space-y-1">
            <span className={fieldLabel}>Sex</span>
            {editing ? (
              <input
                value={v.sex}
                placeholder="male / female / …"
                onChange={(e) => setField("sex", e.target.value)}
                className={filledInput}
              />
            ) : (
              <p className="text-[15px]">{v.sex}</p>
            )}
          </label>
        </div>

        {/* The RPG System build (RPG_DESIGN.md) — frozen against the
            narrator the same way Equipment and Appearance are; the player
            picks it here, at creation or any time after. */}
        <div className="space-y-4">
          <AttributesEditor
            value={v.attributes ?? characterAttributes({ attributes: undefined })}
            editing={editing}
            onChange={(attributes) => setField("attributes", attributes)}
          />
          <SpecialisationsEditor
            catalog={specCatalog}
            held={v.specialisations ?? []}
            editing={editing}
            onChange={(specialisations) => setField("specialisations", specialisations)}
          />
        </div>

        {/* The sheet body — an ordered, player-editable list of blocks (Text
            or Item), each independently enabled/disabled, reorderable and
            deletable. Equipment is the special Item-block type among these;
            the Inventory screen is the party's shared pack. Gear MOVES between
            them — Equip there, Unequip here. */}
        <div className="space-y-3">
          <p className={fieldLabel}>Sheet</p>
          {v.blocks.length === 0 && !editing && (
            <p className="text-[13px] text-[var(--m-text-55)]">No blocks.</p>
          )}
          <div className={editing ? "space-y-3" : "space-y-4"}>
            {v.blocks.map((b, i) => (
              <BlockRow
                key={b.id}
                block={b}
                index={i}
                count={v.blocks.length}
                editing={editing}
                specCatalog={specCatalog}
                onChange={(next) => setBlocks(v.blocks.map((x, j) => (j === i ? next : x)))}
                onMove={(dir) => setBlocks(moveBlock(v.blocks, i, dir))}
                onToggle={() =>
                  setBlocks(v.blocks.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                }
                onRemove={() => setBlocks(v.blocks.filter((_, j) => j !== i))}
                onGenerate={() => setGenBlockId(b.id)}
                onUnequip={b.type === "item" ? () => unequip(member.id, b.id) : undefined}
              />
            ))}
          </div>
          {editing && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBlocks([...v.blocks, makeTextBlock("", "")])}
                className={`flex-1 ${pillOutline}`}
              >
                + Text Block
              </button>
              <button
                type="button"
                onClick={() => setBlocks([...v.blocks, makeItemBlock("", "")])}
                className={`flex-1 ${pillOutline}`}
              >
                + Item Block
              </button>
            </div>
          )}
        </div>

        {editing && (
          <div className="flex gap-2.5">
            <button type="button" onClick={discard} className={`flex-1 ${pillOutline}`}>
              Discard
            </button>
            <button type="button" onClick={save} className={`flex-1 ${pillSolid}`}>
              Save changes
            </button>
          </div>
        )}

        {/* What the STORY may do to this sheet. Auto-Update is gated behind
            read mode — an open draft would overwrite whatever the model just
            wrote the moment the player hits Save Changes. */}
        {!editing && (
          <div className="space-y-2">
            <button type="button" onClick={() => setAutoUpdate(true)} className={`w-full ${pillSolid}`}>
              Auto-Update
            </button>
            {/* The story (a narrator delta or Auto-Update) has rewritten fields
                for THIS adventure only; the authored character is untouched.
                Saving an edit adopts the change, this button throws it away. */}
            {storyChanged && (
              <button type="button" onClick={() => revertOverrides(member.id)} className={`w-full ${pillOutline}`}>
                Revert Story Changes
              </button>
            )}
          </div>
        )}

        {/* Condition — this adventure's mark, not part of the frozen sheet, so
            it sits outside the Edit gate. */}
        <div className="space-y-1.5">
          <p className={fieldLabel}>Condition this adventure</p>
          <textarea
            value={member.condition}
            rows={2}
            placeholder="unhurt"
            onChange={(e) => setCondition(member.id, e.target.value)}
            className={filledTextarea}
          />
          <p className="text-xs text-[var(--m-text-55)]">
            What the story has done to them — a wound, a debt, someone hunting them.
            The narrator reads it every turn and clears it when it's resolved. Blank
            means unmarked, and it never touches their sheet.
          </p>
        </div>

        {member.role === "member" && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className={`mb-1 ${fieldLabel}`}>Standing this adventure</legend>
              <div className="flex flex-wrap gap-2">
                {STANDINGS.map(({ value, label }) => (
                  <Chip
                    key={value}
                    selected={member.standing === value}
                    // Only the scene is capped — every other standing is
                    // always reachable, including stepping out of the party.
                    disabled={member.standing !== value && value === "active" && partyFull}
                    onClick={() => setStanding(member.id, value)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
              <p className="text-xs text-[var(--m-text-55)]">{STANDING_HINT[member.standing]}</p>
            </fieldset>

            <div className="flex flex-col gap-0.5">
              {/* Kicking drops them out of the party and nothing more — they
                  stay in Characters with their portrait and sheet, the story is
                  told nothing about it, and they can be added back later. */}
              {isInParty(member.standing) ? (
                <button
                  type="button"
                  onClick={() => setStanding(member.id, "none")}
                  className="min-h-11 w-full rounded-[10px] px-1 py-2.5 text-left text-[15px] active:bg-[var(--m-surface)]"
                >
                  Kick from Party
                </button>
              ) : (
                <button
                  type="button"
                  disabled={partyFull}
                  onClick={() => setStanding(member.id, "active")}
                  className="min-h-11 w-full rounded-[10px] px-1 py-2.5 text-left text-[15px] disabled:opacity-40 active:bg-[var(--m-surface)]"
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
                      body: "They are removed from this adventure's Characters, along with their portrait. Save slots taken earlier still have them. This can't be undone.",
                      confirmLabel: "Delete character",
                    },
                    () => removeCharacter(member.id),
                  )
                }
                className="min-h-11 w-full rounded-[10px] px-1 py-2.5 text-left text-[15px] text-danger active:bg-[var(--m-surface)]"
              >
                Delete Character
              </button>
            </div>
          </div>
        )}

        {member.role !== "member" && (
          <p className="text-center text-xs text-[var(--m-text-55)]">
            Player character — always in the scene.
          </p>
        )}
      </div>

      {autoUpdate && (
        <AutoUpdateModal
          memberId={member.id}
          memberName={member.name}
          onClose={() => setAutoUpdate(false)}
        />
      )}

      {/* Fed the DRAFT, not the saved character: a block generated right
          after the player typed another one has to read that text. */}
      {genBlock && genBlock.type === "text" && (
        <GenerateFieldModal
          character={{ ...member, ...v }}
          block={genBlock}
          onAccept={(text) =>
            setBlocks(v.blocks.map((b) => (b.id === genBlock.id ? { ...b, text } : b)))
          }
          onClose={() => setGenBlockId(null)}
        />
      )}

      {genBlock && genBlock.type === "item" && (
        <GenerateItemModal
          character={{ ...member, ...v }}
          existing={v.blocks
            .filter((b): b is ItemBlock => b.type === "item" && b.id !== genBlock.id)
            .map((b) => ({ label: b.title, description: b.text, quantity: b.quantity }))}
          replacing={!!(genBlock.title.trim() || genBlock.text.trim())}
          onAccept={(item) =>
            setBlocks(
              v.blocks.map((b) =>
                b.id === genBlock.id
                  ? { ...b, title: item.label, text: item.description, quantity: item.quantity }
                  : b,
              ),
            )
          }
          onClose={() => setGenBlockId(null)}
        />
      )}

      {zoom && portraitUrl && (
        <button
          type="button"
          aria-label="Close full-screen portrait"
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3"
        >
          <img src={portraitUrl} alt={member.name} className="max-h-full max-w-full object-contain" />
        </button>
      )}
      {dialog}
    </main>
  );
}
