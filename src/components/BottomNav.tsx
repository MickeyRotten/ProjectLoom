import { useStore, type Screen } from "../store";

/**
 * The bottom nav bar — the primary route to Party / Inventory / Quests /
 * Journal / Saves now that the gear button has left the top bar. Five labeled
 * rectangles plus one square MENU icon, always visible under the reading area
 * on the play screen.
 */
const LINKS: { screen: Screen; label: string }[] = [
  { screen: "party", label: "Party" },
  { screen: "inventory", label: "Inventory" },
  { screen: "quests", label: "Quests" },
  { screen: "journal", label: "Journal" },
  { screen: "saves", label: "Save" },
];

export function BottomNav() {
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  return (
    <nav className="flex shrink-0 items-stretch gap-2 border-t-2 border-ink bg-paper px-2 py-2">
      {LINKS.map((l) => (
        <button
          key={l.screen}
          type="button"
          disabled={streaming}
          onClick={() => setScreen(l.screen)}
          className="min-h-11 flex-1 border-2 border-ink px-1 text-[10px] uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
        >
          {l.label}
        </button>
      ))}
      <button
        type="button"
        aria-label="Menu"
        disabled={streaming}
        onClick={() => setScreen("menu")}
        className="min-h-11 min-w-11 border-2 border-ink px-3 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
      >
        =
      </button>
    </nav>
  );
}
