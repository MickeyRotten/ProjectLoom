import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";

/**
 * Full-screen INVENTORY view (DESIGN.md → Inventory view): Label · Description
 * · Quantity rows, editable inline. Reached from the fixed INVENTORY button.
 */
export function InventoryScreen() {
  const inventory = useStore((s) => s.game.inventory);
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Inventory" onBack={() => setScreen(null)} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {inventory.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">Your pack is empty.</p>
        )}
        {inventory.map((it, i) => (
          <div key={i} className="space-y-2 border-2 border-ink p-3">
            <div className="flex items-center gap-2">
              <input
                value={it.label}
                onChange={(e) => updateItem(i, { label: e.target.value })}
                placeholder="label"
                className="min-w-0 flex-1 border-2 border-ink bg-paper p-2 font-bold focus:outline-none"
              />
              <span className="uppercase tracking-widest text-sm">×</span>
              <input
                type="number"
                min={0}
                value={it.quantity}
                onChange={(e) => updateItem(i, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                className="w-16 border-2 border-ink bg-paper p-2 text-center tabular-nums focus:outline-none"
              />
            </div>
            <textarea
              value={it.description}
              onChange={(e) => updateItem(i, { description: e.target.value })}
              placeholder="description"
              rows={2}
              className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addItem}
          className="w-full border-2 border-ink px-3 py-2 uppercase tracking-widest active:bg-ink active:text-paper"
        >
          + Add Item
        </button>
      </div>
    </main>
  );
}
