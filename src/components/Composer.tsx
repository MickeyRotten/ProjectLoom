import { useState } from "react";
import { useStore, type Screen } from "../store";

/** Context-menu destinations tucked behind the ⋯ button beside GO. */
const MENU: { screen: Screen; label: string }[] = [
  { screen: "party", label: "Party" },
  { screen: "inventory", label: "Inventory" },
  { screen: "quests", label: "Quests" },
  { screen: "worldnotes", label: "World Notes" },
];

/**
 * Freeform input plus GO. The quick actions (LOOK · WAIT · INVESTIGATE) now
 * ride under the latest beat (see ChatView); the ⋯ button beside GO opens a
 * context menu routing to Party · Inventory · Quests · World Notes.
 */
export function Composer() {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const sendTurn = useStore((s) => s.sendTurn);
  const stopTurn = useStore((s) => s.stopTurn);
  const streaming = useStore((s) => s.streaming);
  const setScreen = useStore((s) => s.setScreen);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    void sendTurn(t);
  };

  return (
    <footer className="p-3">
      <form
        className="relative flex items-stretch border-2 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="flex items-center px-3 py-3">&gt;</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={streaming}
          placeholder={streaming ? "…" : "what do you do?"}
          className="min-w-0 flex-1 bg-paper py-3 text-ink placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stopTurn}
            className="border-l-2 border-ink px-4 uppercase active:bg-ink active:text-paper"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            className="border-l-2 border-ink px-4 uppercase disabled:opacity-40 active:bg-ink active:text-paper"
          >
            Go
          </button>
        )}
        <button
          type="button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={streaming}
          onClick={() => setMenuOpen((o) => !o)}
          className="border-l-2 border-ink px-4 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
        >
          ⋯
        </button>

        {menuOpen && (
          <>
            {/* Backdrop closes the menu on any outside tap. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="menu"
              className="absolute bottom-full right-0 z-20 mb-2 w-40 border-2 border-ink bg-paper"
            >
              {MENU.map((m) => (
                <button
                  key={m.screen}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setScreen(m.screen);
                  }}
                  className="block w-full border-b-2 border-ink px-3 py-3 text-left uppercase tracking-wide last:border-b-0 active:bg-ink active:text-paper"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}
      </form>
    </footer>
  );
}
