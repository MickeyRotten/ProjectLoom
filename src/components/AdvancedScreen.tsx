import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Field, btnSmall } from "./fields";
import type { Settings } from "../types";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_OPTION_INSTRUCTIONS,
  DEFAULT_BANNER_INSTRUCTIONS,
  DEFAULT_PORTRAIT_INSTRUCTIONS,
  DEFAULT_SPOTLIGHT_RULE,
} from "../lib/defaults";

/**
 * Advanced instructions (DESIGN.md → Menu): the player-editable prompt guidance
 * that steers the narrator, the option generator, the spotlight, and the image
 * models. Each field has a Reset to restore its ship default.
 */
type InstrKey = keyof Pick<
  Settings,
  | "customInstructions"
  | "optionInstructions"
  | "spotlightRule"
  | "bannerInstructions"
  | "portraitInstructions"
>;

const FIELDS: { key: InstrKey; label: string; def: string; rows: number }[] = [
  { key: "customInstructions", label: "Narrator Instructions", def: DEFAULT_CUSTOM_INSTRUCTIONS, rows: 6 },
  { key: "optionInstructions", label: "Action Options", def: DEFAULT_OPTION_INSTRUCTIONS, rows: 3 },
  { key: "spotlightRule", label: "Spotlight Rule", def: DEFAULT_SPOTLIGHT_RULE, rows: 4 },
  { key: "bannerInstructions", label: "Banner Style", def: DEFAULT_BANNER_INSTRUCTIONS, rows: 3 },
  { key: "portraitInstructions", label: "Portrait Style", def: DEFAULT_PORTRAIT_INSTRUCTIONS, rows: 3 },
];

export function AdvancedScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Advanced" />

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => update({ showActionOptions: !settings.showActionOptions })}
          className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>AI Suggested Actions</span>
          <span className="border-2 border-ink px-2 py-1 text-sm">
            {settings.showActionOptions ? "ON" : "OFF"}
          </span>
        </button>

        {FIELDS.filter(
          (f) => f.key !== "optionInstructions" || settings.showActionOptions,
        ).map((f) => (
          <Field key={f.key} label={f.label}>
            <textarea
              value={settings[f.key]}
              rows={f.rows}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className="w-full resize-y border-2 border-ink bg-paper p-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => update({ [f.key]: f.def })}
              disabled={settings[f.key] === f.def}
              className={`mt-1 ${btnSmall}`}
            >
              Reset to default
            </button>
          </Field>
        ))}
      </div>
    </main>
  );
}
