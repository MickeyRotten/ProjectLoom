import { useEffect, useRef, type ReactNode } from "react";
import { useStore } from "../store";
import { Options } from "./Options";
import { TurnControls } from "./TurnControls";
import { segmentDialogue } from "../lib/spotlight";
import { parseInline } from "../lib/markdown";
import type { Character } from "../types";

/**
 * The message log. Renders the opening narration, each turn, the live
 * streaming beat, and the AI options tethered directly under the latest beat
 * (loom-turn-protocol: options ride the same beat, above the party strip).
 */
export function ChatView() {
  const opening = useStore((s) => s.game.scenario.openingNarration);
  const messages = useStore((s) => s.game.messages);
  const party = useStore((s) => s.game.characters.filter((c) => c.role === "member"));
  const streaming = useStore((s) => s.streaming);
  const streamText = useStore((s) => s.streamText);
  const error = useStore((s) => s.error);
  const failedInput = useStore((s) => s.failedInput);
  const retryTurn = useStore((s) => s.retryTurn);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));
  const setScreen = useStore((s) => s.setScreen);

  const scrollRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Only follow the tail when the reader is already near the bottom — scrolling
  // up to reread must not get yanked back on every streaming delta.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamText, error]);

  return (
    <section ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <Beat role="narrator" text={opening} party={party} />

      {messages.map((m) => (
        <Beat key={m.id} role={m.role} text={m.content} party={party} />
      ))}

      {streaming && <Beat role="narrator" text={streamText || "…"} party={party} pending />}

      {!streaming && <TurnControls />}
      {!streaming && <Options />}

      {error && (
        <div className="space-y-2 border-2 border-ink p-2">
          {failedInput && (
            <p className="uppercase tracking-wide opacity-80">&gt; {failedInput}</p>
          )}
          <p className="uppercase tracking-widest">! {error}</p>
          {failedInput && (
            <button
              type="button"
              onClick={retryTurn}
              className="w-full border-2 border-ink py-1 uppercase tracking-widest active:bg-ink active:text-paper"
            >
              ↻ Retry
            </button>
          )}
          {!hasKey && (
            <button
              type="button"
              onClick={() => setScreen("modelkey")}
              className="w-full border-2 border-ink py-1 uppercase tracking-widest active:bg-ink active:text-paper"
            >
              ☰ Model &amp; Key
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </section>
  );
}

function Beat({
  role,
  text,
  party,
  pending,
}: {
  role: "player" | "narrator";
  text: string;
  party: Character[];
  pending?: boolean;
}) {
  if (role === "player") {
    return (
      <p className="whitespace-pre-wrap border-l-2 border-ink pl-2 uppercase tracking-wide opacity-80">
        &gt; {text}
      </p>
    );
  }

  // Segment narrator prose so party dialogue (`Name: "…"`) renders distinctly.
  const segments = segmentDialogue(text, party);
  return (
    <div className={`space-y-2 leading-relaxed ${pending ? "opacity-70" : ""}`}>
      {segments.map((seg, i) =>
        seg.speaker ? (
          <p key={i} className="border-l-2 border-ink pl-2">
            <span className="mr-1 font-bold uppercase tracking-wide">{seg.speaker}:</span>
            <span>“<Formatted text={seg.text} />”</span>
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            <Formatted text={seg.text} />
          </p>
        ),
      )}
      {pending && <span className="animate-pulse"> ▊</span>}
    </div>
  );
}

/**
 * Render inline markdown (`**bold**`, `*italic*`, `` `code` ``) as 1-bit-safe
 * spans — bold weight, italic slant, monospace-boxed code. Parsing is pure
 * (see lib/markdown.ts); unbalanced markers fall back to literal text.
 */
function Formatted({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) => {
        let node: ReactNode = s.text;
        if (s.code) {
          node = (
            <code key={i} className="border border-ink px-1">
              {s.text}
            </code>
          );
        }
        const cls = [s.bold ? "font-bold" : "", s.italic ? "italic" : ""]
          .filter(Boolean)
          .join(" ");
        return cls ? (
          <span key={i} className={cls}>
            {node}
          </span>
        ) : (
          <span key={i}>{node}</span>
        );
      })}
    </>
  );
}
