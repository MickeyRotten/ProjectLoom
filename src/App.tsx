import { useStore } from "./store";

/**
 * Phase 0 shell — proves the 1-bit theme, Tailwind tokens, and Zustand store
 * are wired end to end. The real turn loop, options, party strip, and fixed
 * buttons land in Phase 1+ (see DESIGN.md → Build Phases).
 */
export default function App() {
  const { location, day, turnNumber, bumpTurn } = useStore();

  return (
    <main className="flex min-h-full flex-col bg-paper text-ink font-mono">
      <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
        <span className="truncate">{location}</span>
        <span className="whitespace-nowrap">Day {day}</span>
      </header>

      <section className="flex-1 p-3">
        <div className="border-2 border-ink p-3">
          <p className="uppercase tracking-widest">Loom</p>
          <p className="mt-2 opacity-90">
            Scaffold online. 1-bit theme, Tailwind tokens, and the Zustand store
            are wired. Turn loop arrives in Phase 1.
          </p>
        </div>
      </section>

      <footer className="border-t-2 border-ink p-3">
        <button
          type="button"
          onClick={bumpTurn}
          className="w-full border-2 border-ink bg-paper px-3 py-2 uppercase tracking-widest active:bg-ink active:text-paper"
        >
          Turn {turnNumber} — advance
        </button>
      </footer>
    </main>
  );
}
