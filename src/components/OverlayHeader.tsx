import { useStore } from "../store";

/**
 * Shared top header for full-screen overlays — a Back button plus a title
 * (DESIGN.md → Secondary screens: full-screen overlays with a Back button).
 * Back always returns to the previous screen (store history), so a screen
 * reached from the main view goes back to it, not to a fixed parent menu.
 *
 * `onBack` overrides that for screens with their own internal depth (Advanced's
 * sub-menus): they pop their own level first, and only hand Back to the store
 * once they are at their top.
 */
export function OverlayHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const goBack = useStore((s) => s.goBack);
  return (
    <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
      <button
        type="button"
        onClick={onBack ?? goBack}
        className="border-2 border-ink px-2 active:bg-ink active:text-paper"
      >
        &lt; Back
      </button>
      <span className="truncate">{title}</span>
    </header>
  );
}
