import { useStore } from "../store";
import { isGold } from "../lib/defaults";
import type { Item } from "../types";
import { OverlayHeader } from "./OverlayHeader";
import { EditToolbar, btn } from "./fields";
import { useEditBuffer } from "./useEditBuffer";

/**
 * Full-screen INVENTORY view (DESIGN.md → Inventory view): Label · Description
 * · Quantity rows. Reached from the fixed INVENTORY button.
 *
 * Editing is gated behind Edit mode: rows render as read-only text blocks until
 * the player toggles Edit, and changes live in a local draft until Save Changes.
 * Discard Changes (or leaving the screen) reverts and exits edit mode.
 */
export function InventoryScreen() {
  const inventory = useStore((s) => s.game.inventory);
  const setInventory = useStore((s) => s.setInventory);
  const { editing, draft, setDraft, startEdit, save, discard } = useEditBuffer(
    inventory,
    setInventory,
  );

  const list = editing ? draft : inventory;

  const patch = (i: number, p: Partial<Item>) =>
    setDraft((d) => d.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const remove = (i: number) => setDraft((d) => d.filter((_, j) => j !== i));
  const add = () => setDraft((d) => [...d, { label: "", description: "", quantity: 1 }]);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Inventory" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <EditToolbar editing={editing} onEdit={startEdit} onSave={save} onDiscard={discard} />

        {list.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">Your pack is empty.</p>
        )}
        {list.map((it, i) => (
          <div key={i} className="space-y-2 border-2 border-ink p-3">
            {editing ? (
              <>
                <div className="flex items-center gap-2">
                  {/* Gold is permanent: quantity is editable, label is not. */}
                  <input
                    value={it.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder="label"
                    disabled={isGold(it.label)}
                    className="min-w-0 flex-1 border-2 border-ink bg-paper p-2 font-bold focus:outline-none disabled:opacity-100"
                  />
                  <span className="uppercase tracking-widest text-sm">×</span>
                  <input
                    type="number"
                    min={0}
                    value={it.quantity}
                    onChange={(e) =>
                      patch(i, { quantity: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-16 border-2 border-ink bg-paper p-2 text-center tabular-nums focus:outline-none"
                  />
                </div>
                <textarea
                  value={it.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="description"
                  rows={2}
                  className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
                />
                {!isGold(it.label) && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
                  >
                    Remove
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words font-bold">
                    {it.label ? it.label : <span className="opacity-40">—</span>}
                  </span>
                  <span className="tabular-nums">× {it.quantity}</span>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">
                  {it.description ? it.description : <span className="opacity-40">—</span>}
                </div>
              </>
            )}
          </div>
        ))}

        {editing ? (
          <button type="button" onClick={add} className={`w-full ${btn}`}>
            + Add Item
          </button>
        ) : null}
      </div>
    </main>
  );
}
