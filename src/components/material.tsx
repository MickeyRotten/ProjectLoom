/**
 * Shared building blocks for the Material-redesign screens (Play, Menu,
 * Party / Member, Narrator → Model, Features, Inventory, Quests, Journal,
 * Scenario, World Notes, Characters, Places — `Loom Material Redesign.dc.html`,
 * the Claude Design hand-off this pass implements). Every color here is one of
 * the tokens theme.css's "Material-redesign layer" comment documents, so these
 * read correctly under any ink/paper pair the player has picked (Appearance).
 *
 * Screens outside that list (Setup, RPG System, Appearance, Saves, Cloud
 * Saves, Images, every Generate-family, Equip, AutoUpdate and NewAdventure
 * modal) keep using `fields.tsx`'s square 1-bit primitives untouched — this
 * file is additive, not a replacement.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useStore } from "../store";

/** Filled pill — the one primary action on a screen (Save, Regenerate, +New Adventure). */
export const pillSolid =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-5 text-[13px] font-semibold text-paper disabled:opacity-40";

/** Outline pill — secondary actions (Cancel, Edit, Discard, Assign, Drop). */
export const pillOutline =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--m-outline)] bg-transparent px-4 text-[13px] font-semibold text-ink disabled:opacity-40";

/** Outline pill, destructive tint — Undo turn, Delete Character/Entry. */
export const pillDanger =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--m-danger-border)] bg-transparent px-4 text-[13px] font-semibold text-danger disabled:opacity-40";

/** Small icon-only tap target (header pencil / gear / back). */
export const iconBtn =
  "flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink disabled:opacity-40";

/** A flat, borderless full-width row (Menu list, standing text-actions). */
export const flatRow =
  "flex min-h-11 w-full items-center gap-3.5 rounded-[10px] px-1 py-2 text-left text-ink active:bg-[var(--m-surface)]";

/** Filled surface card — quests/items/journal entries, member/scenario blocks. */
export const card = "rounded-[14px] bg-[var(--m-surface)] p-4";

/** Filled-fill text input, no border — the one input style across every redesigned screen. */
export const filledInput =
  "w-full rounded-[10px] border-none bg-[var(--m-surface-strong)] px-3 py-[11px] text-[14px] text-ink outline-none placeholder:text-[var(--m-text-40)] disabled:opacity-50";

export const filledTextarea = `${filledInput} resize-y leading-relaxed`;

/** Small uppercase section/field label. */
export const fieldLabel = "text-[11px] uppercase tracking-[0.1em] text-[var(--m-text-40)]";

/**
 * Section header inside a scrolling list (Menu groups, Party groups, Features
 * groups). Always carries its own top padding, deliberately not a
 * `first:pt-0` — Menu and Features each wrap a group's heading in its own
 * `<section>`/`<div>`, so "first child of its own parent" was true for EVERY
 * group's heading, not just the page's first one, and zeroed the breathing
 * room above "World Lore"/"The World" that the row above it needs.
 */
export const sectionHeading =
  "px-1 pb-0.5 pt-4 text-[11px] uppercase tracking-[0.14em] text-[var(--m-text-40)]";

/** A selectable pill — reasoning level, member standing. One pressed at a time. */
export function Chip({
  selected,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`min-h-9 rounded-full border px-3.5 py-1.5 text-[13px] disabled:opacity-40 ${
        selected
          ? "border-transparent bg-ink text-paper"
          : "border-[var(--m-outline-soft)] bg-transparent text-ink"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Header for a Material-redesign screen. Two shapes, matching the mock-up's
 * own navigation split:
 *  - `onBack` set: a chevron-back button + title (Menu, and the screens Menu
 *    drills into — Narrator's Model section, Features, Scenario, a member's
 *    sheet). These sit ABOVE the bottom nav, so they need their own way back.
 *  - `onBack` omitted: title only, no back button (Party, Inventory, Quests,
 *    Journal) — these are peers of Play on `BottomNav`, which stays visible
 *    under them, so switching tabs already IS the way back.
 * `action` renders on the right (a header pencil toggling edit mode) in a
 * fixed-size slot that's reserved WHETHER OR NOT `action` is passed — so a
 * screen whose pencil only shows in read mode (Member, Inventory, Quests)
 * doesn't grow or shrink its own header when edit mode toggles, and Party/
 * Journal (never pass one) sit at the same header height as Inventory/Quests
 * (always do, in read mode) rather than the shorter one an absent action
 * would otherwise leave.
 */
export function MaterialHeader({
  title,
  back,
  action,
}: {
  title: ReactNode;
  back?: boolean;
  action?: ReactNode;
}) {
  const goBack = useStore((s) => s.goBack);
  return (
    <header className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
      {back && (
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}
      <span className="min-w-0 flex-1 truncate text-[18px] font-medium">{title}</span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center">{action}</span>
    </header>
  );
}

/** The header pencil that toggles a screen's edit mode (Scenario, Member, Inventory, Quests). */
export function EditPencilButton({ onClick, label = "Edit" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={iconBtn}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19 3 20l1-4z" />
      </svg>
    </button>
  );
}

/** Material on/off switch — Features toggles, Images master switch. */
export function Switch({
  on,
  onClick,
  disabled,
  ariaLabel,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on ? "bg-ink" : "bg-[var(--m-track-off)]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-200 ${
          on ? "left-[18px] bg-paper" : "left-0.5 bg-[var(--m-thumb-off)]"
        }`}
      />
    </button>
  );
}
