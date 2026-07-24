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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  editing?: boolean;
}) {
  if (!editing) return <ReadBlock label={label} value={value} />;
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
  editing = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  editing?: boolean;
}) {
  if (!editing) return <ReadBlock label={label} value={value} />;
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
