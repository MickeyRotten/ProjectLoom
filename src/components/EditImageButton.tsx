import { useState } from "react";

/**
 * ✎ button for images: opens a modal text box, submits the instruction to an
 * image-edit action (image + text → image). Shown next to the ⟳ regenerate
 * button on the banner and portraits.
 */
export function EditImageButton({
  label,
  disabled,
  className,
  onSubmit,
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  onSubmit: (instruction: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const submit = () => {
    const instruction = text.trim();
    if (!instruction) return;
    setOpen(false);
    setText("");
    onSubmit(instruction);
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={className}
      >
        ✎
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-4"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          role="presentation"
        >
          <div
            className="w-full max-w-sm space-y-3 border-2 border-ink bg-paper p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="block uppercase tracking-widest text-sm">{label}</span>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Describe the change…"
              className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!text.trim()}
                onClick={submit}
                className="flex-1 border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 border-2 border-ink px-3 py-2 text-sm uppercase tracking-widest active:bg-ink active:text-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
