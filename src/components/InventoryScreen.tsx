import { useState } from "react";
import { useStore } from "../store";
import { isGold } from "../lib/defaults";
import { canEquip } from "../lib/equip";
import type { Item } from "../types";
import { FeatureOffNotice } from "./FeatureOffNotice";
import { EquipModal } from "./EquipModal";
import { GenerateItemModal } from "./GenerateItemModal";
import {
  MaterialHeader,
  EditPencilButton,
  card,
  filledInput,
  filledTextarea,
  pillOutline,
  pillSolid,
} from "./material";
import { useEditBuffer } from "./useEditBuffer";

/**
 * Full-screen INVENTORY view (DESIGN.md → Inventory view) — Material redesign
 * (`Loom Material Redesign.dc.html`): each row a filled surface card. Reached
 * from the bottom nav, which stays visible under this screen (no Back).
 *
 * Editing is gated behind Edit mode — rows render read-only until the header
 * pencil toggles Edit, and changes live in a local draft until Save Changes
 * (bottom of the list). Discard Changes (or leaving the screen) reverts.
 *
 * ASSIGN hands a row to the PC or a companion — the item leaves the pack for
 * their sheet and is never in both (`equip.ts`). DROP removes it outright.
 * Both sit in READ mode only: an open draft is not yet the pack, so moving or
 * dropping a row out from under it would fight whatever Save Changes writes
 * next. ✦ is the opposite arrangement — EDIT mode only, since it drops its
 * result straight into the draft and the undo is Discard Changes.
 */
export function InventoryScreen() {
  const inventory = useStore((s) => s.game.inventory);
  const setInventory = useStore((s) => s.setInventory);
  const removeItem = useStore((s) => s.removeItem);
  const { editing, draft, setDraft, startEdit, save, discard } = useEditBuffer(
    inventory,
    setInventory,
  );
  // The row being handed to someone — index into the live pack, not the draft.
  const [equipping, setEquipping] = useState<number | null>(null);
  // The row being written by the model — index into the draft, since ✦ is only
  // ever offered while editing.
  const [generating, setGenerating] = useState<number | null>(null);

  const list = editing ? draft : inventory;

  const patch = (i: number, p: Partial<Item>) =>
    setDraft((d) => d.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const remove = (i: number) => setDraft((d) => d.filter((_, j) => j !== i));
  const add = () => setDraft((d) => [...d, { label: "", description: "", quantity: 1 }]);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Inventory" action={!editing && <EditPencilButton onClick={startEdit} />} />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <FeatureOffNotice feature="inventory">
          The narrator no longer sees your pack or adds to it, and gold has stopped
          moving. Everything below is kept, and still yours to edit —
        </FeatureOffNotice>

        {list.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">Your pack is empty.</p>
        )}
        {list.map((it, i) => (
          <div key={i} className={card}>
            {editing ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {/* Gold is permanent: quantity is editable, label is not. */}
                  <input
                    value={it.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder="label"
                    disabled={isGold(it.label)}
                    className={`min-w-0 flex-1 font-medium ${filledInput}`}
                  />
                  <span className="text-[13px] text-[var(--m-text-55)]">×</span>
                  <input
                    type="number"
                    min={0}
                    value={it.quantity}
                    onChange={(e) =>
                      patch(i, { quantity: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-14 rounded-[10px] border-none bg-[var(--m-surface-strong)] px-2 py-[11px] text-center tabular-nums text-ink outline-none"
                  />
                </div>
                <textarea
                  value={it.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="description"
                  rows={2}
                  className={`text-[13px] ${filledTextarea}`}
                />
                {/* Gold has neither button: the purse is permanent, and its
                    label is locked, so there is nothing here to write. */}
                {!isGold(it.label) && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => remove(i)} className={pillOutline}>
                      Remove
                    </button>
                    <button
                      type="button"
                      aria-label={it.label.trim() ? `Generate ${it.label.trim()}` : "Generate item"}
                      onClick={() => setGenerating(i)}
                      className={`${pillOutline} !min-h-9 !px-3`}
                    >
                      ✦
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="min-w-0 flex-1 text-[15px] font-medium">
                    {it.label || <span className="text-[var(--m-text-40)]">—</span>}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-[var(--m-text-55)]">
                    × {it.quantity}
                  </span>
                </div>
                {it.description && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--m-text-55)]">
                    {it.description}
                  </p>
                )}
                {/* Gold stays in the purse — it is the party's money, not
                    anybody's gear, and the currency row is permanent. */}
                {canEquip(it) && (
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={() => setEquipping(i)} className={pillOutline}>
                      Assign
                    </button>
                    <button type="button" onClick={() => removeItem(i)} className={pillOutline}>
                      Drop
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {editing && (
          <>
            <button type="button" onClick={add} className={`w-full ${pillOutline}`}>
              + Add Item
            </button>
            <div className="flex gap-2.5">
              <button type="button" onClick={discard} className={`flex-1 ${pillOutline}`}>
                Discard
              </button>
              <button type="button" onClick={save} className={`flex-1 ${pillSolid}`}>
                Save changes
              </button>
            </div>
          </>
        )}
      </div>

      {equipping !== null && inventory[equipping] && (
        <EquipModal
          item={inventory[equipping]}
          index={equipping}
          onClose={() => setEquipping(null)}
        />
      )}

      {/* The row being written is not part of its own context — it is the draft
          being replaced, and listing it would tell the model not to write it. */}
      {generating !== null && draft[generating] && (
        <GenerateItemModal
          existing={draft.filter((_, j) => j !== generating)}
          replacing={
            !!(draft[generating].label.trim() || draft[generating].description.trim())
          }
          onAccept={(item) =>
            patch(generating, {
              label: item.label,
              description: item.description,
              quantity: item.quantity,
            })
          }
          onClose={() => setGenerating(null)}
        />
      )}
    </main>
  );
}
