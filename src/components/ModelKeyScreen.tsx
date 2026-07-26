import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field } from "./fields";
import { KeyField } from "./KeyField";
import { ModelPicker } from "./ModelPicker";
import { splitModels, useModelCatalog } from "./useModelCatalog";
import { REASONING_LEVELS, type ReasoningLevel } from "../types";

/**
 * Labels for the reasoning picker. Short enough for three-across on a phone;
 * "AUTO" is deliberately not called "default", because it means "send nothing
 * and let the model decide", not "our recommended level".
 */
const REASONING_LABELS: Record<ReasoningLevel, string> = {
  auto: "Auto",
  off: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
};

/** One line under the picker explaining the level that is actually selected. */
const REASONING_NOTES: Record<ReasoningLevel, string> = {
  auto: "Nothing is asked for — the model thinks however it normally would.",
  off: "Thinking is switched off where the model allows it. Cheaper and faster; models that always think ignore this.",
  minimal: "The shortest think the model offers before it writes.",
  low: "A little thinking. Slower and dearer than off, steadier on tangled turns.",
  medium: "A balanced think on every turn — noticeably slower and dearer.",
  high: "The longest think the model offers. Slow, and the most expensive way to play.",
};

/**
 * Model & Key (DESIGN.md → Menu): the OpenRouter credentials and model choices
 * that drive text + image generation. The catalog is fetched from OpenRouter on
 * open so text/image models are chosen from a filterable list; on a fetch
 * failure the fields fall back to a free-text model id.
 *
 * Shares `KeyField` and `ModelPicker` with the first-run Setup screen, so the
 * two can never drift on what a key check or a model list looks like.
 */
export function ModelKeyScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const { models, loading, error } = useModelCatalog();
  const { text, image } = splitModels(models);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Model & Key" />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <KeyField
          label="OpenRouter API Key"
          value={settings.openRouterKey}
          onChange={(v) => update({ openRouterKey: v })}
          showSignupLink
        />

        <ModelPicker
          label="Text Model"
          value={settings.textModelId}
          onChange={(v) => update({ textModelId: v })}
          models={text}
          loading={loading}
          error={error}
        />

        <div className="space-y-2">
          <span className="block text-sm uppercase tracking-widest">Reasoning</span>
          <div className="grid grid-cols-3 gap-2">
            {REASONING_LEVELS.map((level) => {
              const current = settings.reasoningLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={current}
                  onClick={() => update({ reasoningLevel: level })}
                  className={`min-h-11 border-2 border-ink px-2 py-2 text-sm uppercase tracking-widest ${
                    current ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                  }`}
                >
                  {REASONING_LABELS[level]}
                </button>
              );
            })}
          </div>
          <p className="text-xs opacity-70">{REASONING_NOTES[settings.reasoningLevel]}</p>
          <p className="text-xs opacity-70">
            How hard the text model thinks before it writes. Only reasoning models do
            anything with this. Thinking is billed like any other output and counts
            against Advanced → Narrator → Beat Length Limit, so a tight cap plus a high
            level can cut a beat off mid-write.
          </p>
        </div>

        <KeyField
          label="Image API Key"
          value={settings.imageKey}
          onChange={(v) => update({ imageKey: v })}
          placeholder="Optional — blank uses the key above"
          hint="Separate key billed for image generation. Leave blank to reuse the OpenRouter API Key."
        />

        <ModelPicker
          label="Image Model"
          value={settings.imageModelId}
          onChange={(v) => update({ imageModelId: v })}
          models={image}
          loading={loading}
          error={error}
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
