/**
 * Shared 1-bit form controls for the Phase 4 authoring screens (scenario,
 * characters, world notes, quests, advanced instructions). Square borders,
 * monospace, no colour — one visual system with the rest of the app.
 */

/** Reusable button styling (square, invert on press). */
export const btn =
  "border-2 border-ink px-3 py-2 uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40";

export const btnSmall =
  "border-2 border-ink px-2 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block uppercase tracking-widest text-sm">{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
      />
    </Field>
  );
}

export function AreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
      />
    </Field>
  );
}
