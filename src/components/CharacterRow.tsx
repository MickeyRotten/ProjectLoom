import type { CharacterStatus } from "../types";

/**
 * One character in a list — shared by the Characters library and the Party
 * view so both read as the same object. The row body opens the sheet; an
 * optional trailing action manages party membership without leaving the list.
 */
export function CharacterRow({
  name,
  sub,
  status,
  detail,
  action,
  onOpen,
}: {
  name: string;
  sub: string;
  /** Standing in this adventure; "active" renders no chip. */
  status?: CharacterStatus;
  /** Optional second line (e.g. Strengths); clamped to two lines. */
  detail?: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
  onOpen: () => void;
}) {
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
        {status && status !== "active" && (
          <p className="mt-1 text-xs uppercase tracking-widest opacity-60">{status}</p>
        )}
        {detail && <p className="mt-1 line-clamp-2 text-sm opacity-80">{detail}</p>}
      </button>
      {action && (
        <button
          type="button"
          disabled={action.disabled}
          onClick={action.onClick}
          className="w-full border-t-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
