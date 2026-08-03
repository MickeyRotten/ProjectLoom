import { useStore } from "../store";
import { KeyField } from "./KeyField";
import { ModelPicker } from "./ModelPicker";
import { splitModels, useModelCatalog } from "./useModelCatalog";
import { btn } from "./fields";

/**
 * First run. Without this, a fresh install dropped the player straight into a
 * running game that could not run: the three quick actions greyed out with no
 * explanation, the freeform input stayed enabled, and the only route to the key
 * screen was to type something, watch the turn fail, and read the error.
 *
 * Shown by `App` whenever no OpenRouter key is set, so it doubles as the
 * recovery path if a key is later cleared. Everything here is also reachable
 * afterwards from Menu → Model & Key; this screen exists to make the one
 * required step unmissable, not to be a separate settings store.
 */
export function SetupScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const scenarioTitle = useStore((s) => s.game.scenario.title);
  const { models, loading, error } = useModelCatalog();
  const { text, image } = splitModels(models);

  const ready = Boolean(settings.openRouterKey.trim());

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <header className="border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
        Loom — Setup
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <p className="border-2 border-ink p-3 text-sm">
          Loom writes its story with a language model you supply. It runs entirely on
          this device and talks to OpenRouter directly, so you need one API key before
          the first turn. Everything below can be changed later under Menu → Model &amp;
          Key.
        </p>

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
          hint="Writes the story. An uncensored or roleplay-tuned model suits Loom best."
        />

        {/* Hidden if the player has already switched image generation off in
            Model & Key — a returning setup (a cleared key) must not offer a
            model for calls that can't happen. */}
        {settings.imagesEnabled && (
        <ModelPicker
          label="Image Model — Optional"
          value={settings.imageModelId}
          onChange={(v) => update({ imageModelId: v })}
          models={image}
          loading={loading}
          error={error}
          hint="Draws character portraits — and location images, once you switch those on in Advanced → Images. Leave it be if you'd rather not spend on images — the game plays fine without them, and Model & Key can switch image generation off entirely."
        />
        )}

        {/* Dismissal is explicit. Gating the screen on "is there a key" instead
            would throw the player out of setup on the first character they
            typed, before they had picked a model. */}
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            update({ openRouterKey: settings.openRouterKey.trim(), setupDone: true })
          }
          className={`w-full ${btn}`}
        >
          {ready ? `Begin — ${scenarioTitle}` : "Add a key to begin"}
        </button>
      </div>
    </main>
  );
}
