import { useState, type ReactNode } from "react";
import { useStore, type Screen } from "../store";
import { NewAdventureModal } from "./NewAdventureModal";
import { pillSolid, sectionHeading, MaterialHeader } from "./material";

/**
 * The gear menu (DESIGN.md → Menu) — Material redesign (`Loom Material
 * Redesign.dc.html`). Flat, borderless rows (icon + label, no sub-label,
 * no box) routing to the authoring + settings sub-screens that don't live in
 * `BottomNav` (Party / Inventory / Quests / Journal — one tap away on every
 * play screen now) or the Play header's gear (this screen itself). Save
 * moved here too, as the first row above both groups, once the bottom nav
 * went down to five icon-only pills. Everything edits the active game
 * directly (no Edit mode). New Adventure opens `NewAdventureModal`, which
 * asks what to carry over — the cast belongs to the adventure being
 * replaced, so nothing survives implicitly any more.
 *
 * **Grouped**, because the list holds two unlike kinds of thing. The split is
 * the one already load-bearing in the data model: **World Lore** lives in
 * `GameState` and is replaced by the next New Adventure, **Settings** lives in
 * `Settings` and outlives every adventure.
 */
type Group = "adventure" | "settings";

const GROUP_LABELS: Record<Group, string> = {
  adventure: "World Lore",
  settings: "Settings",
};

const ENTRIES: { screen: Screen; label: string; group: Group; icon: ReactNode }[] = [
  {
    group: "adventure",
    screen: "scenario",
    label: "Scenario",
    icon: (
      <path d="M6 3h9l3 3v15H6z M15 3v3h3" />
    ),
  },
  {
    group: "adventure",
    screen: "worldnotes",
    label: "World Notes",
    icon: <path d="M4 5c0-1 1-2 2-2h6v18H6c-1 0-2-1-2-2z M12 3h6c1 0 2 1 2 2v14c0 1-1 2-2 2h-6" />,
  },
  {
    group: "adventure",
    screen: "characters",
    label: "Characters",
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="16.3" cy="9.2" r="2.4" />
        <path d="M3.3 20c0-3 2.6-5.5 5.7-5.5s5.7 2.5 5.7 5.5 M14.3 20c0-2.2 1.7-4.1 4-4.6" />
      </>
    ),
  },
  {
    group: "adventure",
    screen: "places",
    label: "Places",
    icon: (
      <>
        <path d="M12 21s-7-7.2-7-12a7 7 0 0 1 14 0c0 4.8-7 12-7 12z" />
        <circle cx="12" cy="9" r="2.3" />
      </>
    ),
  },
  {
    group: "settings",
    screen: "features",
    label: "Features",
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="16" cy="12" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="10" cy="18" r="1.7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    group: "settings",
    screen: "narrator",
    label: "Narrator",
    icon: <path d="M4 5h16v11H10l-4 4v-4H4z" />,
  },
  {
    group: "settings",
    screen: "images",
    label: "Images",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="M21 16l-5.5-5.5L9 17" />
      </>
    ),
  },
  {
    group: "settings",
    screen: "rpg",
    label: "RPG System",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        {[
          [8.3, 8.3],
          [15.7, 8.3],
          [12, 12],
          [8.3, 15.7],
          [15.7, 15.7],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" stroke="none" />
        ))}
      </>
    ),
  },
  {
    group: "settings",
    screen: "appearance",
    label: "Appearance",
    icon: (
      <>
        <path d="M12 3a9 8 0 1 0 0 18c1.2 0 2-1 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-7.5-9-7.5z" />
        <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="7.7" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    group: "settings",
    screen: "sync",
    label: "Cloud Saves",
    icon: <path d="M7 18a4.5 4.5 0 0 1-1-8.9 5.5 5.5 0 0 1 10.7-1.8A4 4 0 0 1 17 18z" />,
  },
];

const GROUPS: Group[] = ["adventure", "settings"];

const SAVE_ICON = (
  <path d="M64 48c-8.726 0-16 7.274-16 16v384c0 8.726 7.274 16 16 16h215v-16H64V64h63.375v97.53c0 3.924 3.443 7.095 7.72 7.095h169.81c4.277 0 7.72-3.17 7.72-7.094V64h69.22c.428.318.8.548 1.467 1.094 2.05 1.675 4.962 4.264 8.375 7.406 6.827 6.283 15.65 14.837 24.313 23.5 8.663 8.663 17.217 17.486 23.5 24.313 3.142 3.413 5.73 6.324 7.406 8.374.546.668.776 1.04 1.094 1.47V330.25l16 16V128c0-2.68-.657-3.402-1.03-4.156a15.312 15.312 0 0 0-1.095-1.844c-.74-1.1-1.575-2.19-2.594-3.438-2.036-2.492-4.768-5.55-8.03-9.093-6.524-7.09-15.155-16-23.938-24.782-8.782-8.783-17.692-17.414-24.78-23.938-3.545-3.262-6.6-5.994-9.094-8.03-1.247-1.02-2.337-1.855-3.438-2.595-.55-.37-1.09-.72-1.844-1.094-.754-.373-1.477-1.03-4.156-1.03H64zm87.72 16h48.56c4.277 0 7.72 4.425 7.72 9.938v70.124c0 5.513-3.443 9.938-7.72 9.938h-48.56c-4.277 0-7.72-4.425-7.72-9.938V73.938c0-5.512 3.443-9.937 7.72-9.937zM114 212c-4.432 0-8 3.568-8 8v184c0 4.432 3.568 8 8 8h165v-28h-76.72l15.345-15.375 128-128L352 234.28l6.375 6.345L406 288.25V220c0-4.432-3.568-8-8-8H114zm238 47.75L245.75 366H297v128h110V366h51.25L352 259.75zM448 384v64h-23v16h23c8.726 0 16-7.274 16-16v-64h-16z" />
);

/** A flat Material row: icon + label, no sub-label, no box. */
function MenuRow({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3.5 rounded-[10px] px-1 py-3 text-left text-ink active:bg-[var(--m-surface)]"
    >
      <svg
        viewBox="0 0 24 24"
        width="21"
        height="21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        {icon}
      </svg>
      <span className="text-[15px]">{label}</span>
    </button>
  );
}

export function MenuScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);
  const game = useStore((s) => s.game);
  const [starting, setStarting] = useState(false);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <MaterialHeader title="Menu" back />

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <MenuRow label="Save" icon={<g fill="currentColor" stroke="none">{SAVE_ICON}</g>} onClick={() => setScreen("saves")} />

        {GROUPS.map((group) => (
          <section key={group}>
            <p className={sectionHeading}>{GROUP_LABELS[group]}</p>
            {ENTRIES.filter((e) => e.group === group).map((e) => (
              <MenuRow key={e.label} label={e.label} icon={e.icon} onClick={() => setScreen(e.screen)} />
            ))}
          </section>
        ))}

        <button
          type="button"
          onClick={() => setStarting(true)}
          className={`mt-5 w-full ${pillSolid}`}
        >
          + New Adventure
        </button>
      </div>

      {starting && (
        <NewAdventureModal
          game={game}
          onClose={() => setStarting(false)}
          onStart={(imports) => {
            setStarting(false);
            newAdventure(imports);
            setScreen(null);
          }}
        />
      )}
    </main>
  );
}
