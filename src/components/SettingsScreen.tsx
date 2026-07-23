import { useStore } from "../store";

/**
 * Phase 1 Settings — full-screen overlay with a Back button (the mobile
 * pattern). Covers the essentials for the core loop: OpenRouter key, text
 * model, temperature, and New Adventure. Advanced instructions, scenario
 * editor, and save slots arrive in Phase 4.
 */
export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);
  const newAdventure = useStore((s) => s.newAdventure);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setScreen(null)}
          className="border-2 border-ink px-2 active:bg-ink active:text-paper"
        >
          &lt; Back
        </button>
        <span>Settings</span>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <Field label="OpenRouter API Key">
          <input
            type="password"
            autoComplete="off"
            value={settings.openRouterKey}
            onChange={(e) => updateSettings({ openRouterKey: e.target.value })}
            placeholder="sk-or-…"
            className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
          />
        </Field>

        <Field label="Text Model">
          <input
            value={settings.textModelId}
            onChange={(e) => updateSettings({ textModelId: e.target.value })}
            placeholder="provider/model"
            className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
          />
        </Field>

        <Field label={`Temperature — ${settings.temperature.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
            className="w-full accent-ink"
          />
        </Field>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              if (confirm("Start a new adventure? The current game is replaced.")) {
                newAdventure();
                setScreen(null);
              }
            }}
            className="w-full border-2 border-ink px-3 py-2 uppercase tracking-widest active:bg-ink active:text-paper"
          >
            New Adventure
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block uppercase tracking-widest text-sm">{label}</span>
      {children}
    </label>
  );
}
