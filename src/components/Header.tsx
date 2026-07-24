import { useStore } from "../store";

export function Header() {
  const location = useStore((s) => s.game.location);
  const day = useStore((s) => s.game.day);
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  return (
    <header className="flex items-center justify-between bg-ink px-3 py-2 text-paper">
      <span className="truncate uppercase">{location}</span>
      <div className="flex items-center gap-3 whitespace-nowrap">
        <span>Day {day}</span>
        <button
          type="button"
          aria-label="Settings"
          disabled={streaming}
          onClick={() => setScreen("menu")}
          className="border-2 border-paper px-2 leading-none disabled:opacity-40 active:bg-paper active:text-ink"
        >
          =
        </button>
      </div>
    </header>
  );
}
