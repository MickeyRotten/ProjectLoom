import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field } from "./fields";
import { KeyField } from "./KeyField";
import { ModelPicker } from "./ModelPicker";
import { splitModels, useModelCatalog } from "./useModelCatalog";

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
