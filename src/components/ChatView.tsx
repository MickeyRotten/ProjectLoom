import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Options } from "./Options";

/**
 * The message log. Renders the opening narration, each turn, the live
 * streaming beat, and the AI options tethered directly under the latest beat
 * (loom-turn-protocol: options ride the same beat, above the party strip).
 */
export function ChatView() {
  const opening = useStore((s) => s.game.scenario.openingNarration);
  const messages = useStore((s) => s.game.messages);
  const streaming = useStore((s) => s.streaming);
  const streamText = useStore((s) => s.streamText);
  const error = useStore((s) => s.error);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamText, error]);

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3">
      <Beat role="narrator" text={opening} />

      {messages.map((m) => (
        <Beat key={m.id} role={m.role} text={m.content} />
      ))}

      {streaming && <Beat role="narrator" text={streamText || "…"} pending />}

      {!streaming && <Options />}

      {error && (
        <div className="border-2 border-ink p-2 uppercase tracking-widest">
          ! {error}
        </div>
      )}

      <div ref={bottomRef} />
    </section>
  );
}

function Beat({
  role,
  text,
  pending,
}: {
  role: "player" | "narrator";
  text: string;
  pending?: boolean;
}) {
  if (role === "player") {
    return (
      <p className="whitespace-pre-wrap border-l-2 border-ink pl-2 uppercase tracking-wide opacity-80">
        &gt; {text}
      </p>
    );
  }
  return (
    <p className={`whitespace-pre-wrap leading-relaxed ${pending ? "opacity-70" : ""}`}>
      {text}
      {pending && <span className="animate-pulse"> ▊</span>}
    </p>
  );
}
