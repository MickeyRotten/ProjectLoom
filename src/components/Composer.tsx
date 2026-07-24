import { useState } from "react";
import { useStore, type Screen } from "../store";

/** Context-menu destinations tucked behind the ⋯ button beside GO. */
const MENU: { screen: Screen; label: string }[] = [
  { screen: "party", label: "Party" },
  { screen: "inventory", label: "Inventory" },
  { screen: "quests", label: "Quests" },
  { screen: "worldnotes", label: "World Notes" },
];

/** Always-visible quick actions, sized like the turn controls. */
const QUICK = [
  { label: "Look", input: "I look around." },
  { label: "Wait", input: "I wait to see what happens." },
  { label: "Investigate", input: "I investigate my immediate surroundings carefully." },
];

/**
 * Quick actions (LOOK · WAIT · INVESTIGATE) above a freeform input plus GO. The
 * ⋯ button beside GO opens a context menu routing to Party · Inventory ·
 * Quests · World Notes.
 */
export function Composer() {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const sendTurn = useStore((s) => s.sendTurn);
  const stopTurn = useStore((s) => s.stopTurn);
  const streaming = useStore((s) => s.streaming);
  const setScreen = useStore((s) => s.setScreen);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    void sendTurn(t);
  };

  return (
    <footer className="space-y-3 p-3">
      <div className="flex gap-2 text-xs uppercase tracking-widest">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={streaming || !hasKey}
            onClick={() => void sendTurn(q.input)}
            className="flex-1 border-2 border-ink py-1 opacity-70 disabled:opacity-30 active:bg-ink active:text-paper active:opacity-100"
          >
            {q.label}
          </button>
        ))}
      </div>

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
