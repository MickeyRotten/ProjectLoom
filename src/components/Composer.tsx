import { useState } from "react";
import { useStore } from "../store";

/**
 * Fixed buttons + freeform input. Phase 1 wires LOOK ("I look around.") and the
 * text input. PARTY / INVENTORY open full-screen views in later phases.
 */
export function Composer() {
  const [text, setText] = useState("");
  const sendTurn = useStore((s) => s.sendTurn);
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
    <footer className="border-t-2 border-ink">
      <div className="grid grid-cols-3 border-b-2 border-ink">
        <button
          type="button"
          disabled={streaming}
          onClick={() => void sendTurn("I look around.")}
          className="border-r-2 border-ink py-2 uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
        >
          Look
        </button>
        <button
          type="button"
          onClick={() => setScreen("party")}
          className="border-r-2 border-ink py-2 uppercase tracking-widest active:bg-ink active:text-paper"
        >
          Party
        </button>
        <button
          type="button"
          onClick={() => setScreen("inventory")}
          className="py-2 uppercase tracking-widest active:bg-ink active:text-paper"
        >
          Inventory
        </button>
      </div>

      <form
        className="flex items-stretch"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="flex items-center px-2">&gt;</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={streaming}
          placeholder={hasKey ? (streaming ? "…" : "what do you do?") : "set API key in settings"}
          className="min-w-0 flex-1 bg-paper py-2 text-ink placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={streaming || !text.trim()}
          className="border-l-2 border-ink px-4 uppercase tracking-widest disabled:opacity-40 active:bg-ink active:text-paper"
        >
          Go
        </button>
      </form>
    </footer>
  );
}
