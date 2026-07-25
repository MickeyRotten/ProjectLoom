import type { Standing } from "../types";

export interface RowAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One character in a list — shared by the Characters library and the Party
 * view so both read as the same object. The row body opens the sheet; the
 * trailing actions manage standing without leaving the list (a party member
 * has two: move them, or drop them).
 */
export function CharacterRow({
  name,
  sub,
  standing,
  detail,
  actions = [],
  onOpen,
}: {
  name: string;
  sub: string;
  /** Standing in this adventure; "active" is the norm and renders no chip. */
  standing?: Standing;
  /** Optional second line (e.g. Strengths). */
  detail?: string;
  actions?: RowAction[];
  onOpen: () => void;
}) {
  const shown = actions.filter(Boolean);
  return (
    <div className="border-2 border-ink">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full p-3 text-left active:bg-ink active:text-paper"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold uppercase tracking-wide">{name}</span>
          <span className="text-sm opacity-70">{sub}</span>
        </div>
        {standing && standing !== "active" && standing !== "none" && (
          <p className="mt-1 text-xs uppercase tracking-widest opacity-60">{standing}</p>
        )}
        {detail && <p className="mt-1 text-sm opacity-80">{detail}</p>}
      </button>
      {shown.length > 0 && (
        <div className="flex border-t-2 border-ink">
          {shown.map((a, i) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              onClick={a.onClick}
              className={`flex-1 px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper ${
                i > 0 ? "border-l-2 border-ink" : ""
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
