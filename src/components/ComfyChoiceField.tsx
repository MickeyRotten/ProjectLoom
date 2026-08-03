import { useState } from "react";
import { Field } from "./fields";

/**
 * A free-text field that can also be picked from a list — the shape every
 * ComfyUI name field wants.
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
    <Field label={label}>
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-2 border-ink bg-paper p-2 focus:outline-none"
        />
        {options.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
          >
            {open ? "▲" : `▼ ${options.length}`}
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <div className="mt-2 border-2 border-ink">
          {options.length > 8 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="w-full border-b-2 border-ink bg-paper p-2 text-sm focus:outline-none"
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
                  className={`block w-full px-2 py-2 text-left text-sm ${
                    o === value ? "bg-ink text-paper" : "active:bg-ink active:text-paper"
                  }`}
                >
                  {o}
                </button>
              </li>
            ))}
            {!shown.length && (
              <li className="px-2 py-2 text-sm opacity-70">Nothing matches.</li>
            )}
          </ul>
        </div>
      )}

      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
    </Field>
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
    <Field label={label}>
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
        className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
    </Field>
  );
}
