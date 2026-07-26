import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * A 1-bit confirmation dialog, replacing native `confirm()`.
 *
 * `confirm()` was used at six destructive call sites, and on the Android
 * WebView it renders as a system-styled alert — rounded corners, platform blue,
 * a completely different typeface — in the middle of a hand-built monochrome
 * app. It also blocks the JS thread and cannot be styled, focus-managed, or
 * given a destructive-action label.
 *
 * Usage:
 *   const { ask, dialog } = useConfirm();
 *   <button onClick={() => ask({ title, body, confirmLabel }, doIt)}>…</button>
 *   {dialog}
 */
export interface ConfirmRequest {
  title: string;
  body?: string;
  /** Label for the destructive button. Defaults to "Confirm". */
  confirmLabel?: string;
}

interface Pending extends ConfirmRequest {
  onConfirm: () => void;
}

export function useConfirm(): {
  ask: (request: ConfirmRequest, onConfirm: () => void) => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Focus goes back where it came from on close — a dialog that drops focus to
  // the top of the document loses a keyboard user their place entirely.
  const restoreTo = useRef<Element | null>(null);

  const ask = useCallback((request: ConfirmRequest, onConfirm: () => void) => {
    restoreTo.current = document.activeElement;
    setPending({ ...request, onConfirm });
  }, []);

  const close = useCallback(() => {
    setPending(null);
    (restoreTo.current as HTMLElement | null)?.focus?.();
  }, []);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const dialog = pending ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pending.title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop: inverted paper so the dialog reads as the only live thing. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink opacity-80"
      />
      <div className="relative w-full max-w-sm space-y-3 border-2 border-ink bg-paper p-4">
        <p className="uppercase tracking-widest">{pending.title}</p>
        {pending.body && <p className="text-sm opacity-80">{pending.body}</p>}
        <div className="flex gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              const run = pending.onConfirm;
              close();
              run();
            }}
            className="min-h-11 flex-1 border-2 border-ink px-3 uppercase tracking-widest active:bg-ink active:text-paper"
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
          <button
            type="button"
            onClick={close}
            className="min-h-11 flex-1 border-2 border-ink px-3 uppercase tracking-widest opacity-70 active:bg-ink active:text-paper active:opacity-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
