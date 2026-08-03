import { useState } from "react";
import { useStore, type Screen } from "../store";
import { usableQuickActions } from "../lib/settings";
import { QuickActionsModal } from "./QuickActionsModal";

/**
 * Context-menu destinations tucked behind the ⋯ button beside GO — the fast
 * route to the screens play actually reaches for. **Saves** is one of them:
 * snapshotting before something risky is a mid-turn act, and living only at the
 * bottom of the gear menu put five taps between the player and the reason they
 * would ever want it.
 */
const MENU: { screen: Screen; label: string }[] = [
  { screen: "party", label: "Party" },
  { screen: "inventory", label: "Inventory" },
  { screen: "quests", label: "Quests" },
  { screen: "worldnotes", label: "World Notes" },
  { screen: "saves", label: "Saves" },
];

/**
 * Quick actions (LOOK · WAIT · INVESTIGATE by default, `Settings.quickActions`
 * once the player edits them) above a freeform input plus GO. ✎ beside the
 * shortcuts opens the editor; the ⋯ button beside GO opens a context menu
 * routing to Party · Inventory · Quests · World Notes · Saves.
 */
export function Composer() {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editQuick, setEditQuick] = useState(false);
  const sendTurn = useStore((s) => s.sendTurn);
  const stopTurn = useStore((s) => s.stopTurn);
  const streaming = useStore((s) => s.streaming);
  const setScreen = useStore((s) => s.setScreen);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));
  // Only the rows with both halves written — a blank one is a button the player
  // deliberately removed.
  const quick = usableQuickActions(useStore((s) => s.settings.quickActions));

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    void sendTurn(t);
  };

  return (
    <footer className="space-y-3 p-3">
      {/* Greyed-out buttons that never say why are their own bug report. */}
      {!hasKey && (
        <button
          type="button"
          onClick={() => setScreen("narrator", "model")}
          className="w-full border-2 border-ink px-3 py-2 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
        >
          No API key set — add one to play
        </button>
      )}

      <div className="flex gap-2 text-xs uppercase tracking-widest">
        {quick.map((q, i) => (
          <button
            key={`${i}-${q.label}`}
            type="button"
            disabled={streaming || !hasKey}
            onClick={() => void sendTurn(q.input)}
            // Tighter than the row's `text-xs tracking-widest`: the ✎ takes a
            // button's width out of the row, and a default label ("Investigate")
            // no longer fits at the old spacing. Truncation is still there as
            // the backstop for whatever the player types in.
            className="min-h-11 flex-1 truncate border-2 border-ink px-1 py-2 text-[0.7rem] tracking-wide opacity-70 disabled:opacity-30 active:bg-ink active:text-paper active:opacity-100"
          >
            {q.label}
          </button>
        ))}
        {/* ✎ sits with them rather than in the gear menu: the moment you want
            a different shortcut is the moment you are looking at the one that
            isn't it. Never disabled — editing a button is not a turn, so it
            stays reachable mid-stream and without a key. */}
        <button
          type="button"
          aria-label="Edit quick actions"
          onClick={() => setEditQuick(true)}
          className="min-h-11 w-11 shrink-0 border-2 border-ink leading-none opacity-70 active:bg-ink active:text-paper active:opacity-100"
        >
          ✎
        </button>
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

      {editQuick && <QuickActionsModal onClose={() => setEditQuick(false)} />}
    </footer>
  );
}
