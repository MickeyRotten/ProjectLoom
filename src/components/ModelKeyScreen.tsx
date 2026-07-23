import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, TextField } from "./fields";

/**
 * Model & Key (DESIGN.md → Menu): the OpenRouter credentials and model choices
 * that drive text + image generation. New Adventure moved to the menu; the
 * narrator/image *instructions* live under Advanced.
 */
export function ModelKeyScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Model & Key" onBack={() => setScreen("menu")} />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <Field label="OpenRouter API Key">
          <input
            type="password"
            autoComplete="off"
            value={settings.openRouterKey}
            onChange={(e) => update({ openRouterKey: e.target.value })}
            placeholder="sk-or-…"
            className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
          />
        </Field>

        <TextField
          label="Text Model"
          value={settings.textModelId}
          onChange={(v) => update({ textModelId: v })}
          placeholder="provider/model"
        />

        <TextField
          label="Image Model"
          value={settings.imageModelId}
          onChange={(v) => update({ imageModelId: v })}
          placeholder="provider/model"
        />

        <Field label={`Temperature — ${settings.temperature.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => update({ temperature: Number(e.target.value) })}
            className="w-full accent-ink"
          />
        </Field>
      </div>
    </main>
  );
}
