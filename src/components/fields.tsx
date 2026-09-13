import { useState } from "react";

/**
 * The last of the shared 1-bit form controls (square borders, monospace, no
 * colour) — kept for the member sheet's Image Options section, the one part
 * of the app the Material redesign deliberately left alone (custom art in /
 * stored art out / no art at all is out of the mock-up's scope). Every other
 * screen this module used to serve — Scenario, Characters, World Notes,
 * Quests, Places, Inventory, RPG System, Appearance, Saves, Cloud Saves,
 * Images, Narrator, Features — has moved onto `material.tsx`.
 */

/**
 * A section that starts closed — a header row that toggles its body open.
 *
 * For the controls a screen needs to OFFER but not to show: the member sheet's
 * portrait tools and prompt override were six buttons and a fieldset standing
 * between the player and the character's name, on a sheet whose whole purpose is
 * the text underneath them. Closed by default, one tap from open, and the tap
 * target is the whole row.
 */
export function Collapsible({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-2 border-ink">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left uppercase tracking-widest active:bg-ink active:text-paper"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="opacity-70">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="space-y-3 border-t-2 border-ink p-3">{children}</div>}
    </div>
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
