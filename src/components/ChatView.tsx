import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Options } from "./Options";
import { TurnControls } from "./TurnControls";
import { segmentDialogue } from "../lib/spotlight";
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

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamText, error]);

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3">
      <Beat role="narrator" text={opening} party={party} />

      {messages.map((m) => (
        <Beat key={m.id} role={m.role} text={m.content} party={party} />
      ))}

      {streaming && <Beat role="narrator" text={streamText || "…"} party={party} pending />}

      {!streaming && <TurnControls />}
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
            <span>“{seg.text}”</span>
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {seg.text}
          </p>
        ),
      )}
      {pending && <span className="animate-pulse"> ▊</span>}
    </div>
  );
}
