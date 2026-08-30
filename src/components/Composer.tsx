import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * The turn input: a `>` prompt, a line of text, and a blinking block cursor.
 * Nothing else — no box, no buttons, no menu.
 *
 * It is **inline**, rendered by `ChatView` as the last thing in the scrolling
 * log rather than pinned to the bottom of the shell. A fixed composer is a
 * permanent slice of a phone screen that a text game spends most of its time
 * not using: the player reads a beat, and the box sits there through all of it.
 * Inline, the prose gets the whole viewport and the input is simply where the
 * conversation currently ends — which is also where the reader already is,
 * since the log follows the tail.
 *
 * **Return sends**, on desktop and on Android alike (a single-line `<input>` in
 * a `<form>`, with `enterKeyHint="send"` so the soft keyboard's action key says
 * so), which is why there is no GO button: a button that duplicates the key
 * every player already presses is chrome the reading area was paying for. The
 * ⋯ context menu went the same way — the gear menu already routes everywhere,
 * and the ⋯ was a second navigation model living in the reading area.
 *
 * The **border** is gone with them. A bordered box is a form field on a web
 * page; `> ` and a cursor is a terminal, which is what this is. Which leaves
 * the caret carrying the whole affordance, so it is drawn rather than
 * inherited: the native caret is hidden (`caret-transparent`) and a **blinking
 * block** (`loom-blink`, a hard step blink — the same cursor the streaming beat
 * trails) is painted at the text offset instead. It is also the focus
 * indicator, solid and blinking with focus and dim and still without, since
 * the ring this app puts on every other input (`.loom-bare`, theme.css) is the
 * box we just took off.
 */
export function Composer() {
  const [text, setText] = useState("");
  // Where the block sits, in characters into `text`. Tracked rather than
  // assumed to be the end: arrowing back mid-line must move the cursor, or the
  // one thing on screen saying where typing lands would be lying.
  const [caret, setCaret] = useState(0);
  const [caretX, setCaretX] = useState(0);
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const sendTurn = useStore((s) => s.sendTurn);
  const stopTurn = useStore((s) => s.stopTurn);
  const streaming = useStore((s) => s.streaming);
  const setScreen = useStore((s) => s.setScreen);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));

  // Measure, don't calculate: `ch` units assume a monospaced face and one of
  // the bundled fonts (Jersey 15) is not one, nor is an added Google font
  // required to be. A hidden mirror span holding the text BEFORE the cursor,
  // in the input's own font, is the width — less however far the input has
  // scrolled, so the block stays put on a line longer than the field.
  useLayoutEffect(() => {
    const w = mirrorRef.current?.getBoundingClientRect().width ?? 0;
    setCaretX(w - (inputRef.current?.scrollLeft ?? 0));
  }, [text, caret, streaming]);

  const sync = (el: HTMLInputElement) =>
    setCaret(el.selectionStart ?? el.value.length);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    setCaret(0);
    void sendTurn(t);
  };

  // Empty and untouched: the block sits at the start with the hint beside it,
  // rather than on top of a placeholder — which is why it is rendered here
  // instead of using the input's own `placeholder`. It does not say "what do
  // you do?": a narrator beat very often ENDS on that line (the shipped opening
  // does), and the app echoing the story back at the player two lines later
  // reads as a bug.
  const hint = !text && !focused;

  return (
    // `text-base` because this now lives inside the log's reading-size
    // container: prose scales with the player's Text Size, chrome does not.
    <footer className="space-y-1 text-base">
      {/* Greyed-out inputs that never say why are their own bug report. */}
      {!hasKey && (
        <button
          type="button"
          onClick={() => setScreen("narrator", "model")}
          className="flex min-h-11 w-full items-center text-left text-xs uppercase tracking-widest active:opacity-60"
        >
          ! No API key set — tap to add one
        </button>
      )}

      <form
        ref={formRef}
        className="flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span aria-hidden="true" className="flex items-center">
          &gt;
        </span>
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              sync(e.target);
            }}
            onSelect={(e) => sync(e.currentTarget)}
            onFocus={(e) => {
              setFocused(true);
              sync(e.currentTarget);
              // `resizes-content` shrinks the shell when the soft keyboard
              // opens; nudge the line back into view once that settles.
              setTimeout(
                () => formRef.current?.scrollIntoView({ block: "end" }),
                300,
              );
            }}
            onBlur={() => setFocused(false)}
            onScroll={(e) =>
              setCaretX(
                (mirrorRef.current?.getBoundingClientRect().width ?? 0) -
                  e.currentTarget.scrollLeft,
              )
            }
            disabled={streaming}
            enterKeyHint="send"
            aria-label="What do you do?"
            className="loom-bare w-full bg-transparent py-2 text-ink caret-transparent focus:outline-none disabled:opacity-40"
          />

          {/* The width of everything left of the cursor, in the input's font.
              `invisible` rather than hidden: it still has to lay out. */}
          <span
            ref={mirrorRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre"
          >
            {text.slice(0, caret)}
          </span>

          {/* The cursor. Hidden mid-turn — the streaming beat trails one of its
              own, and two blinking blocks is two claims about where the game is
              waiting. */}
          {!streaming && (
            <span
              aria-hidden="true"
              style={{ left: `${caretX}px` }}
              className={`pointer-events-none absolute inset-y-0 flex items-center ${
                focused ? "loom-blink" : "opacity-40"
              }`}
            >
              ▊
            </span>
          )}
          {hint && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-4 flex items-center opacity-50"
            >
              type your action
            </span>
          )}
        </div>

        {/* No GO: Return sends. Stop is a different act — it interrupts a turn
            already running — and has no key, so it keeps a control, bracketed
            rather than boxed. */}
        {streaming && (
          <button
            type="button"
            onClick={stopTurn}
            className="min-h-11 shrink-0 px-1 uppercase tracking-widest active:opacity-60"
          >
            [Stop]
          </button>
        )}
      </form>
    </footer>
  );
}
