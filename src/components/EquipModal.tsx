import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { equipTargets } from "../lib/equip";
import type { Item } from "../types";

/** What each standing means for a piece of gear, said in three words. */
const WHERE: Record<string, string> = {
  active: "in the scene",
  benched: "benched",
};

/**
 * "Who gets it?" — the one step between a pack row and a character's kit.
 *
 * A picker rather than a drag: the party is at most four people, the target list
 * fits on a phone without scrolling, and an item that moves on a tap is an item
 * that moves back on a tap. Choosing writes immediately and closes; there is no
 * Save, because the move is already undone by unequipping it.
 *
 * Targets are the PC and the company (`equip.ts → equipTargets`) — benched
 * companions included, since stowing gear on the one who stayed behind is half
 * of what a bench is for.
 */
export function EquipModal({
  item,
  index,
  onClose,
}: {
  item: Item;
  index: number;
  onClose: () => void;
}) {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const equip = useStore((s) => s.equipItem);
  const first = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<Element | null>(null);

  const targets = useMemo(() => equipTargets(characters, roster), [characters, roster]);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Equip ${item.label}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink opacity-80"
      />
      <div className="relative flex max-h-full w-full max-w-sm flex-col gap-3 border-2 border-ink bg-paper p-4">
        <p className="uppercase tracking-widest">
          Equip {item.label}
          {item.quantity > 1 ? ` ×${item.quantity}` : ""}
        </p>
        <p className="text-sm opacity-70">
          Moves out of the pack and onto them — all {item.quantity > 1 ? item.quantity : "of it"}.
          Unequip on their sheet to put it back.
        </p>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {targets.length === 0 && (
            <p className="uppercase tracking-widest text-sm opacity-60">
              No one to equip. Add a character first.
            </p>
          )}
          {targets.map((m, i) => (
            <button
              key={m.id}
              ref={i === 0 ? first : undefined}
              type="button"
              onClick={() => {
                equip(index, m.id);
                onClose();
              }}
              className="flex min-h-11 w-full items-center justify-between gap-2 border-2 border-ink px-3 py-2 text-left active:bg-ink active:text-paper"
            >
              <span className="min-w-0 break-words uppercase tracking-widest">
                {m.name || "(unnamed)"}
              </span>
              <span className="shrink-0 text-xs uppercase tracking-widest opacity-70">
                {m.role === "pc" ? "you" : (WHERE[m.standing] ?? m.standing)}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full border-2 border-ink px-3 uppercase tracking-widest opacity-70 active:bg-ink active:text-paper active:opacity-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
