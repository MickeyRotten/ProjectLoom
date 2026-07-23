import { useStore } from "../store";

export function Header() {
  const location = useStore((s) => s.game.location);
  const day = useStore((s) => s.game.day);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
      <span className="truncate">{location}</span>
      <div className="flex items-center gap-3 whitespace-nowrap">
        <span>Day {day}</span>
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setScreen("settings")}
          className="border-2 border-ink px-2 leading-none active:bg-ink active:text-paper"
        >
          =
        </button>
      </div>
    </header>
  );
}
