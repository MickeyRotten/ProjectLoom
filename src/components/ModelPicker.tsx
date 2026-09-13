import { useMemo, useState } from "react";
import { fieldLabel, filledInput } from "./material";
import type { OpenRouterModel } from "../lib/openrouter";

/**
 * A model picker over the WHOLE catalog for its modality — every text-to-text
 * model OpenRouter lists, not a shortlist. Shared by Narrator → Model, Images
 * → Model and the first-run Setup screen (`material.tsx` styling — every
 * caller is now a Material screen).
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
      <div className="space-y-1.5">
        <span className={fieldLabel}>{label}</span>
        <div className={`${filledInput} text-[var(--m-text-55)]`}>Loading models…</div>
      </div>
    );
  }

  if (error || !models.length) {
    return (
      <div className="space-y-1.5">
        <span className={fieldLabel}>{label}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="provider/model"
          className={filledInput}
        />
        {error && (
          <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
            {error} Enter a model id manually.
          </p>
        )}
      </div>
    );
  }

  const inList = matches.some((m) => m.id === value);
  const freeCount = models.filter((m) => m.free).length;

  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>{label}</span>
      {models.length > 8 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`filter ${models.length} models…`}
          aria-label={`Filter ${label} list`}
          className={filledInput}
        />
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size={1}
        aria-label={label}
        className={filledInput}
      >
        {!inList && value && <option value={value}>{value} (current)</option>}
        {matches.map((m) => (
          <option key={m.id} value={m.id}>
            {m.free ? `${m.name} — free` : m.name}
          </option>
        ))}
      </select>
      <label className="flex min-h-9 items-center gap-2 pt-0.5 text-[13px]">
        <input
          type="checkbox"
          checked={freeOnly}
          onChange={(e) => setFreeOnly(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-ink"
        />
        <span>Free models only ({freeCount})</span>
      </label>
      {hint && <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">{hint}</p>}
    </div>
  );
}
