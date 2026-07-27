/**
 * Shared 1-bit form controls for the Phase 4 authoring screens (scenario,
 * characters, world notes, quests, advanced instructions). Square borders,
 * monospace, no colour — one visual system with the rest of the app.
 *
 * Edit-mode aware: the Quests / Inventory / Character sheets gate editing behind
 * an Edit toggle. Pass `editing={false}` to render a field as a read-only text
 * block (full text, no truncation) instead of an input/textarea. Screens that
 * are always editable simply omit the prop (defaults to `true`).
 */

/**
 * Reusable button styling (square, invert on press).
 *
 * `min-h-11` is 44px — the minimum comfortable touch target. `btnSmall` used to
 * come out around 26px tall and is used for Restore / Delete / Remove / Reset
 * across five screens, i.e. exactly the actions worth not mis-tapping. It stays
 * visually small (text-xs, tight padding); only the hit area grew.
 */
export const btn =
  "inline-flex min-h-11 items-center justify-center border-2 border-ink px-3 py-2 uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40";

export const btnSmall =
  "inline-flex min-h-11 items-center justify-center border-2 border-ink px-3 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper disabled:opacity-40";

/** A group heading inside a list — Characters and Party split by standing. */
export function Section({ label }: { label: string }) {
  return <p className="pt-2 text-sm uppercase tracking-widest opacity-60">{label}</p>;
}

/**
 * A full-width on/off row — the settings-screen toggle (Advanced, RPG System).
 * Distinct from `ToggleField`'s checkbox: this is the whole row, for a setting
 * that stands on its own rather than sitting inside a form.
 */
export function ToggleRow({
  label,
  state,
  onClick,
}: {
  label: string;
  state: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between border-2 border-ink p-3 text-left uppercase tracking-widest active:bg-ink active:text-paper"
    >
      <span>{label}</span>
      <span className="border-2 border-ink px-2 py-1 text-sm">{state}</span>
    </button>
  );
}

/**
 * A labelled control. `action` puts a control of its own on the label row — the
 * member sheet's ✦ generate buttons. It changes the markup rather than sliding
 * into the existing `<label>`: a button nested inside a label that wraps a form
 * control activates that control when tapped. With an action the caption becomes
 * plain text in a flex row and the field keeps a visually-hidden label of its
 * own, so the control is still named for a screen reader.
 */
export function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!action) {
    return (
      <label className="block space-y-1">
        <span className="block uppercase tracking-widest text-sm">{label}</span>
        {children}
      </label>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="uppercase tracking-widest text-sm">{label}</span>
        {action}
      </div>
      <label className="block">
        <span className="sr-only">{label}</span>
        {children}
      </label>
    </div>
  );
}

/** Read-only rendering of a field value: full text, wrapped, never truncated. */
export function ReadBlock({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className="w-full whitespace-pre-wrap break-words p-2">
        {value ? value : <span className="opacity-40">—</span>}
      </div>
    </Field>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  editing = true,
  action,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  editing?: boolean;
  /** Control for the label row (e.g. ✦ generate). Read mode ignores it. */
  action?: React.ReactNode;
}) {
  if (!editing) return <ReadBlock label={label} value={value} />;
  return (
    <Field label={label} action={action}>
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
  editing = true,
  action,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  editing?: boolean;
  /** Control for the label row (e.g. ✦ generate). Read mode ignores it. */
  action?: React.ReactNode;
}) {
  if (!editing) return <ReadBlock label={label} value={value} />;
  return (
    <Field label={label} action={action}>
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

/**
 * Labelled checkbox — a boolean field in the same 1-bit system. Read-only mode
 * renders the state as text so it reads like the other blocks.
 */
export function ToggleField({
  label,
  value,
  onChange,
  hint,
  editing = true,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  editing?: boolean;
}) {
  if (!editing) return <ReadBlock label={label} value={value ? "Yes" : "No"} />;
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
      />
      <span className="block">
        <span className="block uppercase tracking-widest text-sm">{label}</span>
        {hint && <span className="block text-xs uppercase tracking-widest opacity-60">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Edit-mode toolbar: an "Edit" toggle when read-only, and "Save Changes" /
 * "Discard Changes" while editing. Rendered by the gated screens (Quests,
 * Inventory, Character sheet).
 */
export function EditToolbar({
  editing,
  onEdit,
  onSave,
  onDiscard,
}: {
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!editing) {
    return (
      <button type="button" onClick={onEdit} className={`w-full ${btn}`}>
        Edit
      </button>
    );
  }
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onSave} className={`flex-1 ${btn}`}>
        Save Changes
      </button>
      <button type="button" onClick={onDiscard} className={`flex-1 ${btn}`}>
        Discard Changes
      </button>
    </div>
  );
}
