import { useRef, useState } from "react";
import { useStore, type Screen } from "../store";

/**
 * Context-menu destinations tucked behind the ⋯ button beside the input — the
 * fast route to the screens play actually reaches for. **Saves** is one of them:
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
 * The turn input — a freeform line plus the ⋯ context menu, and nothing else.
 *
 * It is **inline**, rendered by `ChatView` as the last thing in the scrolling
 * log rather than pinned to the bottom of the shell. A fixed composer is a
 * permanent slice of a phone screen that a text game spends most of its time
 * not using: the player reads a beat, and the box sits there through all of it.
 * Inline, the prose gets the whole viewport and the input is simply where the
 * conversation currently ends — which is also where the reader already is,
 * since the log follows the tail.
 *
 * **Return sends** on desktop and on Android alike (a single-line `<input>` in
 * a `<form>`, with `enterKeyHint="send"` so the soft keyboard's action key says
 * so), which is why there is no GO button: a button that duplicates the key
 * every player already presses is chrome the reading area was paying for. The
 * quick-action shortcuts are gone with it — the narrator's own action options
 * are the same affordance, written for the beat in front of you.
 */
export function Composer() {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
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
    // `text-base` because this now lives inside the log's reading-size
    // container: prose scales with the player's Text Size, chrome does not.
    <footer className="space-y-2 pt-1 text-base">
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

      <form
        ref={formRef}
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
          // The soft keyboard's action key. `resizes-content` shrinks the shell
          // when it opens, and the log is scrolled to its tail, so an inline
          // composer stays on screen — but only if it was at the tail to begin
          // with, hence the nudge on focus.
          enterKeyHint="send"
          onFocus={() =>
            setTimeout(() => formRef.current?.scrollIntoView({ block: "end" }), 300)
          }
          placeholder={streaming ? "…" : "what do you do?"}
          className="min-w-0 flex-1 bg-paper py-3 text-ink placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        {/* No GO: Return sends. Stop is a different act — it interrupts a turn
            already running — and has no key, so it keeps its button. */}
        {streaming && (
          <button
            type="button"
            onClick={stopTurn}
            className="border-l-2 border-ink px-4 uppercase active:bg-ink active:text-paper"
          >
            Stop
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
