import { useStore } from "../store";

/**
 * Shared top header for full-screen overlays — a Back button plus a title
 * (DESIGN.md → Secondary screens: full-screen overlays with a Back button).
 * Back always returns to the previous screen (store history), so a screen
 * reached from the main view goes back to it, not to a fixed parent menu.
 *
 * There is no `onBack` override any more: a screen with its own internal depth
 * (Advanced's sub-menus) registers `setBackHandler` on the store instead, so the
 * ANDROID back button pops the same level this button does. A prop could never
 * do that — the hardware button has no way to reach a component's local state.
 */
export function OverlayHeader({ title }: { title: string }) {
  const goBack = useStore((s) => s.goBack);
  return (
    <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
      <button
        type="button"
        onClick={goBack}
        className="min-h-11 border-2 border-ink px-3 active:bg-ink active:text-paper"
      >
        &lt; Back
      </button>
      <span className="truncate">{title}</span>
    </header>
  );
}
