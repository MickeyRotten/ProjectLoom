import { useStore } from "../store";
import { portraitKey } from "../lib/images";
import { card, pillOutline } from "./material";
import type { Standing } from "../types";

export interface RowAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One character in the Characters library — Material redesign (`Loom
 * Material Redesign.dc.html`): a filled surface card, avatar + name + a
 * standing-managing action row underneath, matching Inventory/Quests' own
 * card-with-actions shape. The card body opens the sheet; the trailing
 * actions manage standing without leaving the list.
 */
export function CharacterRow({
  id,
  name,
  sub,
  standing,
  detail,
  actions = [],
  onOpen,
}: {
  id: string;
  name: string;
  sub: string;
  /** Standing in this adventure; "active" is the norm and renders no label. */
  standing?: Standing;
  /** Optional second line (e.g. Strengths). */
  detail?: string;
  actions?: RowAction[];
  onOpen: () => void;
}) {
  const portraitUrl = useStore((s) => s.images[portraitKey(id)]);
  const shown = actions.filter(Boolean);

  return (
    <div className={card}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3.5 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--m-avatar)] text-[15px] font-semibold">
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt=""
              className="h-full w-full origin-top scale-150 object-cover object-top"
            />
          ) : (
            (name[0] ?? "?").toUpperCase()
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-medium">{name}</span>
            <span className="shrink-0 text-[12.5px] text-[var(--m-text-55)]">{sub}</span>
          </span>
          {standing && standing !== "active" && standing !== "none" && (
            <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--m-text-40)]">
              {standing}
            </span>
          )}
          {/* Clamped: Strengths is a free-text paragraph now, and a list row is
              a glance, not the sheet. */}
          {detail && (
            <span className="mt-0.5 block truncate text-[12.5px] text-[var(--m-text-55)]">
              {detail}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="var(--m-outline)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {shown.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2 pl-[52px]">
          {shown.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              onClick={a.onClick}
              className={`${pillOutline} !min-h-9 !px-3.5`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
