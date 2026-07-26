import { useStore, type Screen } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import type { TextScale } from "../types";
import { useConfirm } from "./useConfirm";

/**
 * The gear menu (DESIGN.md → Menu): a full-screen list routing to every
 * authoring + settings sub-screen. Everything edits the active game directly
 * (no Edit mode). New Adventure reseeds from the current scenario + roster.
 */
/**
 * Every screen, in one place. Party / Inventory / Quests / World Notes also
 * have the faster ⋯ shortcut beside GO, but they used to live ONLY there —
 * which meant the gear menu, the one thing that looks like navigation, pointed
 * at barely half the app, and four screens were reachable solely through a
 * glyph that reads as "overflow".
 */
const ENTRIES: { screen: Screen; label: string; note: string }[] = [
  { screen: "party", label: "Party", note: "Who travels with you · bench" },
  { screen: "inventory", label: "Inventory", note: "Carried items · gold" },
  { screen: "quests", label: "Quests", note: "Active + finished objectives" },
  { screen: "worldnotes", label: "World Notes", note: "Lore the story remembers" },
  { screen: "characters", label: "Characters", note: "Full cast · add to party" },
  { screen: "scenario", label: "Scenario", note: "Title · premise · opening" },
  { screen: "modelkey", label: "Model & Key", note: "OpenRouter key · models" },
  { screen: "advanced", label: "Advanced", note: "Narrator + image instructions" },
  { screen: "saves", label: "Saves", note: "Snapshot · restore slots" },
];

const TEXT_SIZES: { value: TextScale; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

export function MenuScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);
  const invert = useStore((s) => s.settings.invert);
  const textScale = useStore((s) => s.settings.textScale);
  const bannerSize = useStore((s) => s.settings.bannerSize);
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

        <div className="mt-2 space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest">Text Size</span>
          <div className="grid grid-cols-4 gap-2">
            {TEXT_SIZES.map(({ value, label }) => {
              const current = textScale === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current}
                  onClick={() => updateSettings({ textScale: value })}
                  className={`border-2 border-ink px-2 py-2 text-sm uppercase tracking-widest ${
                    current ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-sm opacity-60">
            Scales the story text only — buttons and labels keep their size. Pinch to
            zoom still works too.
          </p>
        </div>

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

        <button
          type="button"
          aria-pressed={invert}
          onClick={() => updateSettings({ invert: !invert })}
          className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>Invert Colors</span>
          <span className="opacity-70">{invert ? "On" : "Off"}</span>
        </button>

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
