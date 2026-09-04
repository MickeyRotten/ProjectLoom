import { useState } from "react";
import { useStore, type Screen } from "../store";
import { NewAdventureModal } from "./NewAdventureModal";
import { OverlayHeader } from "./OverlayHeader";
import { Section } from "./fields";

/**
 * The gear menu (DESIGN.md → Menu): a full-screen list routing to the
 * authoring + settings sub-screens that don't live in `BottomNav` (Party /
 * Inventory / Quests / Journal / Saves — those are one tap away on every play
 * screen now). Everything edits the active game directly (no Edit mode). New
 * Adventure opens `NewAdventureModal`, which asks what to carry over — the
 * cast belongs to the adventure being replaced, so nothing survives implicitly
 * any more.
 *
 * **Grouped**, because the list holds two unlike kinds of thing. The split is
 * the one already load-bearing in the data model: **World Lore** lives in
 * `GameState` and is replaced by the next New Adventure, **Settings** lives in
 * `Settings` and outlives every adventure. Captions rather than a nested
 * *Settings* screen — the depth would cost a tap on every visit and buy nothing
 * the caption doesn't.
 */
type Group = "adventure" | "settings";

const GROUP_LABELS: Record<Group, string> = {
  adventure: "World Lore",
  settings: "Settings",
};

// Party / Inventory / Quests / Journal / Saves moved to the bottom nav bar —
// this group is now just the adventure's lore, in the order it's authored.
const ENTRIES: { screen: Screen; label: string; note: string; group: Group }[] = [
  { group: "adventure", screen: "scenario", label: "Scenario", note: "Title · premise · opening" },
  { group: "adventure", screen: "worldnotes", label: "World Notes", note: "Lore the story remembers" },
  { group: "adventure", screen: "characters", label: "Characters", note: "Full cast · add to party" },
  { group: "adventure", screen: "places", label: "Places", note: "Areas you have been · rooms · tags" },
  { group: "settings", screen: "narrator", label: "Narrator", note: "API key · model · voice · memory" },
  { group: "settings", screen: "images", label: "Images", note: "Portraits · prompts · storage" },
  { group: "settings", screen: "rpg", label: "RPG System", note: "Dice · outcomes · what counts as risky" },
  { group: "settings", screen: "appearance", label: "Appearance", note: "Text size · font · colors" },
  { group: "settings", screen: "sync", label: "Cloud Saves", note: "Keep your snapshots on another device" },
];

const GROUPS: Group[] = ["adventure", "settings"];

export function MenuScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);
  const game = useStore((s) => s.game);
  const [starting, setStarting] = useState(false);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Menu" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {GROUPS.map((group) => (
          <section key={group} className="space-y-3">
            <Section label={GROUP_LABELS[group]} />
            {ENTRIES.filter((e) => e.group === group).map((e) => (
              <button
                key={e.label}
                type="button"
                onClick={() => setScreen(e.screen)}
                className="block w-full border-2 border-ink p-3 text-left active:bg-ink active:text-paper"
              >
                <div className="font-bold uppercase tracking-wide">{e.label}</div>
                <div className="mt-1 text-sm opacity-70">{e.note}</div>
              </button>
            ))}
          </section>
        ))}

        {/* Below a rule and off the end of both groups: it replaces the whole
            first group, so it is not one more place to navigate to. */}
        <button
          type="button"
          onClick={() => setStarting(true)}
          className="mt-4 block w-full border-t-2 border-ink pt-4 text-left"
        >
          <span className="block w-full border-2 border-ink p-3 uppercase tracking-widest">
            New Adventure
          </span>
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
