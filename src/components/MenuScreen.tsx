import { useStore, type Screen } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { useConfirm } from "./useConfirm";

/**
 * The gear menu (DESIGN.md → Menu): a full-screen list routing to every
 * authoring + settings sub-screen. Everything edits the active game directly
 * (no Edit mode). New Adventure reseeds from the current scenario + roster.
 */
/**
 * Every screen, in one place, play-facing first. Party / Inventory / Quests /
 * World Notes / **Saves** also have the faster ⋯ shortcut beside GO, but they
 * used to live ONLY there — which meant the gear menu, the one thing that looks
 * like navigation, pointed at barely half the app, and four screens were
 * reachable solely through a glyph that reads as "overflow".
 *
 * Saves sits with them rather than last: snapshotting is something you do
 * *during* play, right before the fight, not a settings chore.
 */
const ENTRIES: { screen: Screen; label: string; note: string }[] = [
  { screen: "party", label: "Party", note: "Who travels with you · bench" },
  { screen: "inventory", label: "Inventory", note: "Carried items · gold" },
  { screen: "quests", label: "Quests", note: "Active + finished objectives" },
  { screen: "worldnotes", label: "World Notes", note: "Lore the story remembers" },
  { screen: "journal", label: "Journal", note: "What has happened, day by day" },
  { screen: "saves", label: "Saves", note: "Snapshot · restore slots" },
  { screen: "characters", label: "Characters", note: "Full cast · add to party" },
  { screen: "scenario", label: "Scenario", note: "Title · premise · opening" },
  { screen: "modelkey", label: "Model & Key", note: "OpenRouter key · models" },
  { screen: "appearance", label: "Appearance", note: "Text size · font · colors" },
  { screen: "rpg", label: "RPG System", note: "Dice · outcomes · what counts as risky" },
  { screen: "advanced", label: "Advanced", note: "Narrator + image instructions" },
];

export function MenuScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);
  const bannerSize = useStore((s) => s.settings.bannerSize);
  const locationImages = useStore((s) => s.settings.locationImages);
  const updateSettings = useStore((s) => s.updateSettings);
  const { ask, dialog } = useConfirm();

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Menu" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {ENTRIES.map((e) => (
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

        {/* Sizing a banner that doesn't exist is noise — the feature toggle
            lives in Advanced → Images. */}
        {locationImages && (
          <button
            type="button"
            aria-pressed={bannerSize === "compact"}
            onClick={() =>
              updateSettings({ bannerSize: bannerSize === "compact" ? "full" : "compact" })
            }
            className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
          >
            <span>Compact Location Image</span>
            <span className="opacity-70">{bannerSize === "compact" ? "On" : "Off"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            ask(
              {
                title: "Start a new adventure?",
                body: "Your Characters are kept and NPCs carry over, but the party empties and the game you are playing now is replaced. Snapshot it under Saves first if you want it back.",
                confirmLabel: "New adventure",
              },
              () => {
                newAdventure();
                setScreen(null);
              },
            )
          }
          className="mt-2 block w-full border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          New Adventure
        </button>
      </div>
      {dialog}
    </main>
  );
}
