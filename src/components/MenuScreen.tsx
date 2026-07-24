import { useStore, type Screen } from "../store";
import { OverlayHeader } from "./OverlayHeader";

/**
 * The gear menu (DESIGN.md → Menu): a full-screen list routing to every
 * authoring + settings sub-screen. Everything edits the active game directly
 * (no Edit mode). New Adventure reseeds from the current scenario + roster.
 */
// Quests + World Notes moved to the main-screen ⋯ context menu (beside GO).
const ENTRIES: { screen: Screen; label: string; note: string }[] = [
  { screen: "scenario", label: "Scenario", note: "Title · premise · opening" },
  { screen: "characters", label: "Characters", note: "PC + party roster" },
  { screen: "modelkey", label: "Model & Key", note: "OpenRouter key · models" },
  { screen: "advanced", label: "Advanced", note: "Narrator + image instructions" },
  { screen: "saves", label: "Saves", note: "Snapshot · restore slots" },
];

export function MenuScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);
  const invert = useStore((s) => s.settings.invert);
  const updateSettings = useStore((s) => s.updateSettings);

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

        <button
          type="button"
          aria-pressed={invert}
          onClick={() => updateSettings({ invert: !invert })}
          className="mt-2 flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>Invert Colors</span>
          <span className="opacity-70">{invert ? "On" : "Off"}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (confirm("Start a new adventure? The current game is replaced.")) {
              newAdventure();
              setScreen(null);
            }
          }}
          className="mt-2 block w-full border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          New Adventure
        </button>
      </div>
    </main>
  );
}
