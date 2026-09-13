import { useState } from "react";
import { fieldLabel, filledInput, pillOutline } from "./material";

/**
 * A free-text field that can also be picked from a list — the shape every
 * ComfyUI name field wants. Material redesign (`Loom Material Redesign.dc.html`)
 * — the only caller is `ComfyFields`, itself Material, so this is restyled
 * outright rather than behind a `material` flag.
 *
 * Free text is the floor: a checkpoint name is whatever the player's disk says,
 * and a workflow may not even use the field. But typing `dreamshaperXL_v21.safetensors`
 * exactly, from memory, on a phone, is the single most likely way to end up
 * with a portrait that never draws — so when the option list has been loaded
 * from `/object_info`, the names become tappable. The filter box appears only
 * once the list is long enough to need one; a model library can run to hundreds.
 */
export function ComfyChoiceField({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.toLowerCase().includes(needle))
    : options;

  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>{label}</span>
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`min-w-0 flex-1 ${filledInput}`}
        />
        {options.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={`shrink-0 ${pillOutline}`}
          >
            {open ? "▲" : `▼ ${options.length}`}
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <div className="overflow-hidden rounded-[10px] bg-[var(--m-surface)]">
          {options.length > 8 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="w-full bg-[var(--m-surface-strong)] px-3 py-2 text-[13px] outline-none"
            />
          )}
          <ul className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                    setFilter("");
                  }}
                  className={`block min-h-11 w-full px-3 py-2.5 text-left text-[13px] ${
                    o === value ? "bg-ink text-paper" : ""
                  }`}
                >
                  {o}
                </button>
              </li>
            ))}
            {!shown.length && (
              <li className="px-3 py-2.5 text-[13px] text-[var(--m-text-55)]">Nothing matches.</li>
            )}
          </ul>
        </div>
      )}

      {hint && <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">{hint}</p>}
    </div>
  );
}

/** A labelled number input — the ComfyUI params are all one of these. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        // Clamped on the way in, mirroring `normalizeComfy` — the same rule
        // guards the edit path and the read path, so neither can surprise the
        // other.
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className={filledInput}
      />
      {hint && <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">{hint}</p>}
    </div>
  );
}
