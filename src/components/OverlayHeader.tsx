/**
 * Shared top header for full-screen overlays — a Back button plus a title
 * (DESIGN.md → Secondary screens: full-screen overlays with a Back button).
 */
export function OverlayHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex items-center justify-between border-b-2 border-ink px-3 py-2 uppercase tracking-widest">
      <button
        type="button"
        onClick={onBack}
        className="border-2 border-ink px-2 active:bg-ink active:text-paper"
      >
        &lt; Back
      </button>
      <span className="truncate">{title}</span>
    </header>
  );
}
