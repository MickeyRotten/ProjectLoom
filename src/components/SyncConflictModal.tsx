import { useStore } from "../store";
import type { GameSummary } from "../lib/sync";

/**
 * Two devices played the same save while apart, and both copies are real games.
 *
 * This is the only moment cloud sync interrupts anybody, so it asks in the
 * story's own terms — where you are, what day, how many turns — rather than with
 * two timestamps nobody can tell apart. Both games are already snapshotted into
 * save slots by the time this renders (`syncEngine.ts → askAboutGame`), which is
 * why it can be a two-button question with no warning attached: the answer is
 * always undoable from Saves.
 *
 * Rendered beside `DiceOverlay` in `App.tsx` rather than inside a screen, since
 * a sync lands whenever it lands and the prompt has to survive whatever the
 * player happens to have open. It has no dismiss: the sync is holding for an
 * answer, and "later" is what closing the app already means.
 */
export function SyncConflictModal() {
  const conflict = useStore((s) => s.syncConflict);
  if (!conflict) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Two versions of this game"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div aria-hidden="true" className="absolute inset-0 bg-ink opacity-80" />
      <div className="relative w-full max-w-sm space-y-3 border-2 border-ink bg-paper p-4">
        <p className="uppercase tracking-widest">Two versions of this game</p>
        <p className="text-sm opacity-80">
          This device and the cloud both moved on since the last sync. Pick the one to
          keep playing — the other is saved as a slot either way.
        </p>

        <Choice label="On this device" summary={conflict.local} onPick={() => conflict.choose("local")} />
        <Choice label="In the cloud" summary={conflict.cloud} onPick={() => conflict.choose("cloud")} />
      </div>
    </div>
  );
}

function Choice({
  label,
  summary,
  onPick,
}: {
  label: string;
  summary: GameSummary;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="block w-full border-2 border-ink p-3 text-left active:bg-ink active:text-paper"
    >
      <div className="uppercase tracking-widest">{label}</div>
      <div className="mt-1 text-sm opacity-70">
        {summary.title} · Day {summary.day} · Turn {summary.turn}
      </div>
      <div className="text-sm opacity-70">
        {summary.location || "—"}
        {summary.at ? ` · ${new Date(summary.at).toLocaleString()}` : ""}
      </div>
    </button>
  );
}
