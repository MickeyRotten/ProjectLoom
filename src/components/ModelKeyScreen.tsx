import { useEffect, useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, TextField } from "./fields";
import { fetchModels, type OpenRouterModel } from "../lib/openrouter";

/**
 * Model & Key (DESIGN.md → Menu): the OpenRouter credentials and model choices
 * that drive text + image generation. The catalog is fetched from OpenRouter on
 * open so text/image models are chosen from a dropdown; on a fetch failure the
 * screen falls back to a free-text model id.
 */
export function ModelKeyScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);

  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchModels(ctrl.signal)
      .then((list) => setModels(list))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load model list.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  // Image models emit images; everything else is a text model. If the catalog
  // never loaded, both lists are empty and the fields fall back to text input.
  const imageModels = models.filter((m) => m.outputModalities.includes("image"));
  const textModels = models.filter((m) => !m.outputModalities.includes("image"));

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Model & Key" />

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

        <ModelField
          label="Text Model"
          value={settings.textModelId}
          onChange={(v) => update({ textModelId: v })}
          models={textModels}
          loading={loading}
          error={error}
        />

        <Field label="Image API Key">
          <input
            type="password"
            autoComplete="off"
            value={settings.imageKey}
            onChange={(e) => update({ imageKey: e.target.value })}
            placeholder="Optional — blank uses the key above"
            className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
          />
          <span className="mt-1 block text-xs opacity-60">
            Separate key billed for image generation. Leave blank to reuse the OpenRouter API Key.
          </span>
        </Field>

        <ModelField
          label="Image Model"
          value={settings.imageModelId}
          onChange={(v) => update({ imageModelId: v })}
          models={imageModels}
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

/**
 * A model picker: a native dropdown of the fetched catalog once it loads. The
 * current value is always selectable even if it is not in the list. While the
 * catalog is loading — or if it failed — it degrades to a free-text field so a
 * model id can still be entered.
 */
function ModelField({
  label,
  value,
  onChange,
  models,
  loading,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  models: OpenRouterModel[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Field label={label}>
        <div className="w-full border-2 border-ink bg-paper p-2 opacity-60">Loading models…</div>
      </Field>
    );
  }

  if (error || !models.length) {
    return (
      <>
        <TextField label={label} value={value} onChange={onChange} placeholder="provider/model" />
        {error && <p className="-mt-3 text-xs opacity-60">{error} Enter a model id manually.</p>}
      </>
    );
  }

  const inList = models.some((m) => m.id === value);

  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none border-2 border-ink bg-paper p-2 focus:outline-none"
      >
        {!inList && value && <option value={value}>{value} (custom)</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
