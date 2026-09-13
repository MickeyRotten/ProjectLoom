import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { equipTargets } from "../lib/equip";
import { pillOutline } from "./material";
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
        className="absolute inset-0 cursor-default bg-[color-mix(in_srgb,var(--ink)_55%,transparent)]"
      />
      <div className="relative flex max-h-full w-full max-w-sm flex-col gap-3 rounded-[16px] bg-paper p-5 font-mono text-ink shadow-xl">
        <p className="text-[16px] font-semibold">
          Assign {item.label}
          {item.quantity > 1 ? ` ×${item.quantity}` : ""}
        </p>
        <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
          Moves out of the pack and onto them — all {item.quantity > 1 ? item.quantity : "of it"}.
          Unequip on their sheet to put it back.
        </p>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {targets.length === 0 && (
            <p className="text-[13px] text-[var(--m-text-55)]">No one to equip. Add a character first.</p>
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
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] bg-[var(--m-surface)] px-3.5 py-2.5 text-left"
            >
              <span className="min-w-0 break-words text-[15px] font-medium">
                {m.name || "(unnamed)"}
              </span>
              <span className="shrink-0 text-[12px] uppercase tracking-widest text-[var(--m-text-55)]">
                {m.role === "pc" ? "you" : (WHERE[m.standing] ?? m.standing)}
              </span>
            </button>
          ))}
        </div>

        <button type="button" onClick={onClose} className={`w-full ${pillOutline}`}>
          Cancel
        </button>
      </div>
    </div>
  );
}
