import { useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { useConfirm } from "./useConfirm";
import { btn, btnSmall } from "./fields";
import {
  COLOR_PRESETS,
  FONT_LABELS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_SIZE_STEP,
  clampTextSize,
} from "../lib/settings";
import { FONT_CHOICES } from "../types";

/**
 * Settings → Appearance: everything that changes how Loom LOOKS and nothing
 * that changes how it plays.
 *
 * All three controls here started as closed lists — a four-step text scale,
 * three fonts, and an Invert Colors toggle — and all three are now open. The
 * player types a Google font name, sets the reading size in real pixels, and
 * picks the two colors directly. Invert survives as the first two presets,
 * which is all it ever was: one point in a two-color space.
 */
export function AppearanceScreen() {
  const textSize = useStore((s) => s.settings.textSize);
  const font = useStore((s) => s.settings.font);
  const webFonts = useStore((s) => s.settings.webFonts);
  const paper = useStore((s) => s.settings.paper);
  const ink = useStore((s) => s.settings.ink);
  const highlightColor = useStore((s) => s.settings.highlightColor);
  const dialogueColor = useStore((s) => s.settings.dialogueColor);
  const fontPending = useStore((s) => s.fontPending);
  const fontError = useStore((s) => s.fontError);
  const updateSettings = useStore((s) => s.updateSettings);
  const addWebFont = useStore((s) => s.addWebFont);
  const removeWebFont = useStore((s) => s.removeWebFont);

  const [newFont, setNewFont] = useState("");
  const { ask, dialog } = useConfirm();

  const step = (by: number) => updateSettings({ textSize: clampTextSize(textSize + by) });

  const add = async () => {
    const name = newFont.trim();
    if (!name || fontPending) return;
    await addWebFont(name);
    // Only clear the box on success — a rejected name is the thing the player
    // now wants to correct, and wiping it would make them retype the typo.
    if (!useStore.getState().fontError) setNewFont("");
  };

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Appearance" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest">Text Size</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-TEXT_SIZE_STEP)}
              disabled={textSize <= MIN_TEXT_SIZE}
              aria-label={`Smaller text (${textSize - TEXT_SIZE_STEP} pixels)`}
              className={`flex-1 ${btn}`}
            >
              −
            </button>
            <span
              aria-live="polite"
              className="min-w-24 border-2 border-ink px-2 py-2 text-center tracking-widest"
            >
              {textSize} px
            </span>
            <button
              type="button"
              onClick={() => step(TEXT_SIZE_STEP)}
              disabled={textSize >= MAX_TEXT_SIZE}
              aria-label={`Larger text (${textSize + TEXT_SIZE_STEP} pixels)`}
              className={`flex-1 ${btn}`}
            >
              +
            </button>
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
              const { label, note } = FONT_LABELS[value];
              return (
                <FontRow
                  key={value}
                  label={label}
                  note={note}
                  current={font === value}
                  onSelect={() => updateSettings({ font: value })}
                />
              );
            })}

            {webFonts.map((f) => (
              <FontRow
                key={f.id}
                label={f.family}
                note="Added from Google Fonts — stored on device."
                current={font === f.id}
                onSelect={() => updateSettings({ font: f.id })}
                onRemove={() =>
                  ask(
                    {
                      title: `Remove ${f.family}?`,
                      body: "Its files are deleted from this device. Adding it again needs a connection.",
                      confirmLabel: "Remove",
                    },
                    () => void removeWebFont(f.id),
                  )
                }
              />
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <input
              value={newFont}
              placeholder="Google font name"
              aria-label="Google font name"
              onChange={(e) => setNewFont(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              className="min-w-0 flex-1 border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={fontPending || !newFont.trim()}
              className={btn}
            >
              {fontPending ? "…" : "Add"}
            </button>
          </div>
          {fontError && <p className="text-sm">{fontError}</p>}
          <p className="text-sm opacity-60">
            Type a family from fonts.google.com — the name has to match its spelling.
            The files download once and are kept on the device, so an added font works
            offline like the bundled two. It carries no size measurement of its own,
            so reach for Text Size above if it comes out small.
          </p>
        </div>

        <div className="space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest">Colors</span>

          <ColorRow
            label="Background"
            value={paper}
            onChange={(v) => updateSettings({ paper: v })}
          />
          <ColorRow label="Text" value={ink} onChange={(v) => updateSettings({ ink: v })} />
          <ColorRow
            label="Names & Items"
            value={highlightColor}
            onChange={(v) => updateSettings({ highlightColor: v })}
          />
          <ColorRow
            label="Dialogue"
            value={dialogueColor}
            onChange={(v) => updateSettings({ dialogueColor: v })}
          />

          <span className="block pt-1 text-sm uppercase tracking-widest opacity-60">
            Presets
          </span>
          <div className="grid grid-cols-2 gap-2">
            {COLOR_PRESETS.map((p) => {
              const current = paper === p.paper && ink === p.ink;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={current}
                  onClick={() => updateSettings({ paper: p.paper, ink: p.ink })}
                  // The swatch shows the pair it would apply, so it is painted
                  // in literal colors rather than the ink/paper tokens — a
                  // preset that rendered in the CURRENT theme would preview
                  // nothing.
                  style={{ background: p.paper, color: p.ink, borderColor: p.ink }}
                  className={`min-h-11 border-2 px-2 py-2 text-sm uppercase tracking-widest ${
                    current ? "outline outline-2 outline-offset-2 outline-ink" : ""
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="text-sm opacity-60">
            All four colors apply everywhere. Names & Items highlights known
            characters and item names in the story text; Dialogue colors
            quoted speech. Portrait art is stored as the image model drew it
            and does not change with the colors you pick.
          </p>
        </div>
      </div>
      {dialog}
    </main>
  );
}

/** One selectable typeface — bundled or added. Added ones carry a Remove. */
function FontRow({
  label,
  note,
  current,
  onSelect,
  onRemove,
}: {
  label: string;
  note: string;
  current: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        aria-pressed={current}
        onClick={onSelect}
        className={`block min-h-11 flex-1 border-2 border-ink p-2 text-left ${
          current ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
        }`}
      >
        <span className="uppercase tracking-wide">{label}</span>
        <span className="mt-1 block text-sm opacity-70">{note}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className={btnSmall}
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * A color picker plus the hex it holds. The native swatch is the fast path; the
 * text box beside it is how a player types a value they already know, and how
 * anyone reads back what is set — a swatch alone tells you nothing you can
 * write down.
 */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  // Typed hex commits only when it is complete: applying every keystroke would
  // repaint the app through "#f", "#f0", "#f0a" on the way to "#f0aa55".
  const commit = (next: string) => {
    setDraft(next);
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next.trim())) onChange(next.trim());
  };

  return (
    <label className="flex items-center gap-2">
      <span className="flex-1 uppercase tracking-widest text-sm">{label}</span>
      <input
        value={shown}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setDraft(null)}
        aria-label={`${label} hex value`}
        className="w-28 border-2 border-ink bg-paper p-2 text-center focus:outline-none"
      />
      <input
        type="color"
        value={value}
        onChange={(e) => {
          setDraft(null);
          onChange(e.target.value);
        }}
        aria-label={`${label} color`}
        className="h-11 w-11 shrink-0 border-2 border-ink bg-paper p-1"
      />
    </label>
  );
}
