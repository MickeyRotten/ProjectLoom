import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Options } from "./Options";
import { TurnControls } from "./TurnControls";
import { segmentDialogue } from "../lib/spotlight";
import { parseInline } from "../lib/markdown";
import { deriveToasts } from "../lib/toasts";
import type { Character, Message } from "../types";

/** Which message (id) is being edited, and the working draft. */
type Editing = { id: string; role: "player" | "narrator"; draft: string };

/**
 * The message log. Renders the opening narration, each turn, the live
 * streaming beat, and — tethered under the latest beat — the AI options and
 * quick actions (loom-turn-protocol: options ride the same beat, above the
 * party strip). Tapping the latest beat reveals its controls: Regen/Edit/Undo
 * on the narrator beat, Edit on the player beat.
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
  const editMessage = useStore((s) => s.editMessage);
  const editUserTurn = useStore((s) => s.editUserTurn);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));
  const setScreen = useStore((s) => s.setScreen);

  // Which latest beat has its controls revealed (tap to toggle), and any
  // in-progress inline edit. Both reset when a turn streams or completes.
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  useEffect(() => {
    if (streaming) {
      setActive(null);
      setEditing(null);
    }
  }, [streaming]);
  useEffect(() => {
    setActive(null);
    setEditing(null);
  }, [messages.length]);

  const lastNarratorId = [...messages].reverse().find((m) => m.role === "narrator")?.id;
  const lastPlayerId = [...messages].reverse().find((m) => m.role === "player")?.id;

  const scrollRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Only follow the tail when the reader is already near the bottom — scrolling
  // up to reread must not get yanked back on every streaming delta. The bottom
  // marker sits below the quick actions, so following it keeps them in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamText, error, streaming]);

  const toggle = (id: string) => {
    if (editing) return;
    setActive((a) => (a === id ? null : id));
  };

  return (
    <section
      ref={scrollRef}
      className="mt-3 flex-1 space-y-3 overflow-y-auto px-3 pb-3 text-base"
    >
      <Beat role="narrator" text={opening} party={party} />

      {messages.map((m) => {
        const tappable = m.id === lastNarratorId || m.id === lastPlayerId;
        const isEditing = editing?.id === m.id;
        return (
          // A narrator beat sits tight under its player line so an exchange
          // reads as one unit; the next turn keeps the wider section gap.
          <div key={m.id} className={`space-y-2 ${m.role === "narrator" ? "!mt-1" : ""}`}>
            {isEditing ? (
              <Editor
                draft={editing.draft}
                onChange={(v) => setEditing({ ...editing, draft: v })}
                onSave={() => {
                  if (editing.role === "narrator") editMessage(editing.id, editing.draft);
                  else editUserTurn(editing.draft);
                  setEditing(null);
                  setActive(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div
                onClick={tappable ? () => toggle(m.id) : undefined}
                className={tappable ? "cursor-pointer" : undefined}
              >
                <Beat role={m.role} text={m.content} party={party} />
              </div>
            )}

            {/* Inline state-change toasts, tethered under the beat that
                applied them (derived from its recorded deltas). */}
            {m.role === "narrator" && !isEditing && <Toasts msg={m} />}

            {/* Player beat: tap reveals an Edit button (edit + re-roll turn). */}
            {m.id === lastPlayerId && active === m.id && !isEditing && (
              <button
                type="button"
                onClick={() => setEditing({ id: m.id, role: "player", draft: m.content })}
                className="w-full border-2 border-ink py-1 text-xs uppercase tracking-widest opacity-70 active:bg-ink active:text-paper active:opacity-100"
              >
                ✎ Edit
              </button>
            )}
          </div>
        );
      })}

      {streaming && (
        <div className="!mt-1">
          <Beat role="narrator" text={streamText || "…"} party={party} pending />
        </div>
      )}

      {/* Narrator beat controls — revealed by tapping the latest narrator beat. */}
      {!streaming && active === lastNarratorId && editing?.id !== lastNarratorId && (
        <TurnControls
          onEdit={() => {
            const m = messages.find((x) => x.id === lastNarratorId);
            if (m) setEditing({ id: m.id, role: "narrator", draft: m.content });
          }}
        />
      )}

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

/** Chip row of state-change announcements for one narrator beat. */
function Toasts({ msg }: { msg: Message }) {
  const toasts = deriveToasts(msg);
  if (!toasts.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {toasts.map((t, i) => (
        <span
          key={i}
          className="border border-ink px-2 py-0.5 text-xs uppercase tracking-widest opacity-80"
        >
          ◆ {t}
        </span>
      ))}
    </div>
  );
}

function Editor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        autoFocus
        className="w-full resize-y border-2 border-ink bg-paper p-2 text-base focus:outline-none"
      />
      <div className="flex gap-2 text-xs uppercase tracking-widest">
        <button
          type="button"
          onClick={onSave}
          className="flex-1 border-2 border-ink py-1 active:bg-ink active:text-paper"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border-2 border-ink py-1 opacity-70 active:bg-ink active:text-paper active:opacity-100"
        >
          Cancel
        </button>
      </div>
    </div>
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
