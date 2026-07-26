import { useMemo, useState } from "react";
import { Field, TextField } from "./fields";
import type { OpenRouterModel } from "../lib/openrouter";

/** Rows shown before the player narrows the list. */
const VISIBLE_LIMIT = 60;

/**
 * A model picker with a filter box.
 *
 * The catalog runs to several hundred entries, and a native `<select>` over all
 * of them is unusable on a phone — finding the shipped default meant scrolling
 * blind through an alphabetical wall. Typing narrows it; the current value is
 * always offered even when it isn't in the catalog, and while the catalog is
 * loading (or if it failed) this degrades to a free-text model id so a model can
 * still be entered.
 */
export function ModelPicker({
  label,
  value,
  onChange,
  models,
  loading,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  models: OpenRouterModel[];
  loading: boolean;
  error: string | null;
  hint?: string;
}) {
  const [filter, setFilter] = useState("");

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [filter, models]);

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

  const shown = matches.slice(0, VISIBLE_LIMIT);
  const inList = shown.some((m) => m.id === value);
  const hidden = matches.length - shown.length;

  return (
    <Field label={label}>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`filter ${models.length} models…`}
        aria-label={`Filter ${label} list`}
        className="mb-2 w-full border-2 border-ink bg-paper p-2 focus:outline-none"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size={1}
        className="w-full appearance-none border-2 border-ink bg-paper p-2 focus:outline-none"
      >
        {/* The current pick is always selectable, even when the filter or the
            catalog excludes it — otherwise typing a filter silently reassigns
            the model out from under the player. */}
        {!inList && value && <option value={value}>{value} (current)</option>}
        {shown.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {hidden > 0 && (
        <p className="mt-1 text-xs opacity-60">
          {hidden} more — keep typing to narrow the list.
        </p>
      )}
      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
    </Field>
  );
}
