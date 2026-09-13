import { useEffect, useState } from "react";
import { useStore, type Screen } from "../store";
import playIcon from "../../assets/UI/icons/play_white.svg";
import partyIcon from "../../assets/UI/icons/party_white.svg";
import inventoryIcon from "../../assets/UI/icons/inventory_white.svg";
import questsIcon from "../../assets/UI/icons/quests_white.svg";
import journalIcon from "../../assets/UI/icons/journal_white.svg";

/**
 * The bottom nav bar — Material redesign (DESIGN.md, Loom Material Redesign
 * mock-up). Icon-only pills; the active tab gets an ink-filled pill behind its
 * icon that expands in from nothing (scale-x 0 → 1, a bouncy overshoot) rather
 * than a border square. Save left the bar for the Menu's top row and Menu
 * itself left for the gear icon on the Play screen header (`Header.tsx`), so
 * this is down to the five destinations that stay one tap away everywhere:
 * Play / Party / Inventory / Quests / Journal.
 */
const LINKS: { screen: Screen; label: string; icon: string }[] = [
  { screen: null, label: "Play", icon: playIcon },
  { screen: "party", label: "Party", icon: partyIcon },
  { screen: "inventory", label: "Inventory", icon: inventoryIcon },
  { screen: "quests", label: "Quests", icon: questsIcon },
  { screen: "journal", label: "Journal", icon: journalIcon },
];

/** Same recolor-by-mask trick as before: one asset, tinted by `currentColor`
 *  via the wrapping element's text color, so it works under any ink/paper
 *  pair and flips instantly between the pill's "on" and "off" states. */
function NavIcon({ src }: { src: string }) {
  return (
    <span
      aria-hidden="true"
      className="relative z-10 block h-5 w-5 bg-current"
      style={{
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

export function BottomNav() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  // The active pill starts scaled to 0 and eases in just after mount, so the
  // very first paint doesn't show it already fully grown — the same beat the
  // mock-up's `pillReady` gives the opening tab.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <nav className="flex shrink-0 items-stretch border-t border-[var(--m-divider)] bg-paper px-1 pb-2 pt-1">
      {LINKS.map((l) => {
        const on = ready && screen === l.screen;
        return (
          <button
            key={l.label}
            type="button"
            disabled={streaming}
            onClick={() => setScreen(l.screen)}
            className={`flex flex-1 flex-col items-center gap-0.5 bg-transparent py-1.5 disabled:opacity-40 ${
              on ? "text-paper" : "text-ink"
            }`}
          >
            <span className="relative flex h-[30px] w-[46px] items-center justify-center">
              <span
                aria-hidden="true"
                className={`absolute inset-0 origin-center rounded-full bg-ink transition-transform duration-[320ms] ease-[cubic-bezier(0.34,1.35,0.4,1)] ${
                  on ? "scale-x-100" : "scale-x-0"
                }`}
              />
              <NavIcon src={l.icon} />
            </span>
            <span className={`text-[10px] text-ink ${on ? "font-semibold" : "font-normal"}`}>
              {l.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
