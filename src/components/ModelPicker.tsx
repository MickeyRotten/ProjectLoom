import { useMemo, useState } from "react";
import { Field, TextField } from "./fields";
import type { OpenRouterModel } from "../lib/openrouter";

/**
 * A model picker over the WHOLE catalog for its modality — every text-to-text
 * model OpenRouter lists, not a shortlist.
 *
 * It used to cut the list off after the first 60 rows and tell the player to
 * keep typing, which made an alphabetical accident ("ai21…", "amazon…") look
 * like a curated selection and hid most of the catalog behind a search box that
 * only helps if you already know the model's name. Everything is rendered now;
 * the filter box narrows it, and a Free-only checkbox is there for playing on
 * nothing.
 *
 * The current value is always offered even when it isn't in the catalog, and
 * while the catalog is loading (or if it failed) this degrades to a free-text
 * model id so a model can still be entered.
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
  const [freeOnly, setFreeOnly] = useState(false);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return models.filter((m) => {
      if (freeOnly && !m.free) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [filter, freeOnly, models]);

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

  const inList = matches.some((m) => m.id === value);
  const freeCount = models.filter((m) => m.free).length;

  return (
    <div className="space-y-1">
      {/* Not a <Field>: the free checkbox is a second control, and nesting two
          labels inside one is invalid HTML. */}
      <span className="block text-sm uppercase tracking-widest">{label}</span>

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
        aria-label={label}
        className="w-full appearance-none border-2 border-ink bg-paper p-2 focus:outline-none"
      >
        {/* The current pick is always selectable, even when the filter or the
            catalog excludes it — otherwise typing a filter silently reassigns
            the model out from under the player. */}
        {!inList && value && <option value={value}>{value} (current)</option>}
        {matches.map((m) => (
          <option key={m.id} value={m.id}>
            {m.free ? `${m.name} — free` : m.name}
          </option>
        ))}
      </select>

      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={freeOnly}
          onChange={(e) => setFreeOnly(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-ink"
        />
        <span className="text-xs uppercase tracking-widest">
          Free models only ({freeCount})
        </span>
      </label>

      <p className="text-xs opacity-60">
        {matches.length === models.length
          ? `${models.length} models`
          : `${matches.length} of ${models.length} models`}
      </p>
      {freeOnly && !matches.length && (
        <p className="text-xs opacity-60">
          No free model matches that filter — clear the filter or untick Free.
        </p>
      )}
      {hint && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}
