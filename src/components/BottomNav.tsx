import { useStore, type Screen } from "../store";
import partyIcon from "../../assets/UI/icons/party_white.svg";
import inventoryIcon from "../../assets/UI/icons/inventory_white.svg";
import questsIcon from "../../assets/UI/icons/quests_white.svg";
import journalIcon from "../../assets/UI/icons/journal_white.svg";
import saveIcon from "../../assets/UI/icons/save_white.svg";

/**
 * The bottom nav bar — the primary route to Party / Inventory / Quests /
 * Journal / Saves now that the gear button has left the top bar. Five icon +
 * label rectangles plus one square MENU icon, always visible under the
 * reading area on the play screen.
 */
const LINKS: { screen: Screen; label: string; icon: string }[] = [
  { screen: "party", label: "Party", icon: partyIcon },
  { screen: "inventory", label: "Inventory", icon: inventoryIcon },
  { screen: "quests", label: "Quests", icon: questsIcon },
  { screen: "journal", label: "Journal", icon: journalIcon },
  { screen: "saves", label: "Save", icon: saveIcon },
];

/**
 * One flat white glyph, recolored by CSS mask rather than swapped between a
 * black/white pair — `background-color: currentColor` (`bg-current`) means it
 * always matches the button's own text color, ink or paper alike, including
 * the moment `active:text-paper` inverts it on press. One asset per icon
 * instead of two, and it's exactly right for any player-chosen ink/paper pair
 * (Appearance), not just the two shipped themes a black/white swap would cover.
 */
function NavIcon({ src }: { src: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-5 w-5 bg-current"
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
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
          className="flex min-h-14 flex-1 flex-col items-center gap-1 border-2 border-ink px-1 pb-1 pt-2 disabled:opacity-40 active:bg-ink active:text-paper"
        >
          <NavIcon src={l.icon} />
          <span className="mt-auto text-[9px] uppercase leading-none tracking-widest">
            {l.label}
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label="Menu"
        disabled={streaming}
        onClick={() => setScreen("menu")}
        className="min-h-14 min-w-14 border-2 border-ink px-3 text-lg leading-none disabled:opacity-40 active:bg-ink active:text-paper"
      >
        =
      </button>
    </nav>
  );
}
