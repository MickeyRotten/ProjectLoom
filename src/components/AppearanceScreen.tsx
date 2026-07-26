import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { FONT_LABELS } from "../lib/settings";
import { FONT_CHOICES } from "../types";
import type { TextScale } from "../types";

/**
 * Settings → Appearance: everything that changes how Loom LOOKS and nothing
 * that changes how it plays. Text Size and Invert Colors used to sit loose at
 * the bottom of the gear menu, below the nine screen entries — navigation and
 * controls in one scroll, with the controls hidden under the list. Font arrives
 * here as a third of the same kind, so the menu stays a menu.
 */
const TEXT_SIZES: { value: TextScale; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

export function AppearanceScreen() {
  const invert = useStore((s) => s.settings.invert);
  const textScale = useStore((s) => s.settings.textScale);
  const font = useStore((s) => s.settings.font);
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Appearance" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-2 border-2 border-ink p-3">
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
                  className={`min-h-11 border-2 border-ink px-2 py-2 text-sm uppercase tracking-widest ${
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

        <div className="space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest">Font</span>
          <div className="space-y-2">
            {FONT_CHOICES.map((value) => {
              const current = font === value;
              const { label, note } = FONT_LABELS[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current}
                  onClick={() => updateSettings({ font: value })}
                  className={`block min-h-11 w-full border-2 border-ink p-2 text-left ${
                    current ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                  }`}
                >
                  <span className="uppercase tracking-wide">{label}</span>
                  <span className="mt-1 block text-sm opacity-70">{note}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sm opacity-60">
            Applies to the whole app. Both bundled faces ship with Loom, so they work
            offline.
          </p>
        </div>

        <button
          type="button"
          aria-pressed={invert}
          onClick={() => updateSettings({ invert: !invert })}
          className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
        >
          <span>Invert Colors</span>
          <span className="opacity-70">{invert ? "On" : "Off"}</span>
        </button>
      </div>
    </main>
  );
}
