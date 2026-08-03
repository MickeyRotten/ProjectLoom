import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Options } from "./Options";
import { TurnControls } from "./TurnControls";
import { segmentDialogue } from "../lib/spotlight";
import { parseInline } from "../lib/markdown";
import { deriveToasts } from "../lib/toasts";
import { OUTCOME_LABEL, bandScale, formatRoll, modifierNote } from "../lib/stakes";
import type { Character, Message } from "../types";

/** Which message (id) is being edited, and the working draft. */
type Editing = { id: string; role: "player" | "narrator"; draft: string };

/** How close to the tail still counts as "following the tail" (px). */
const NEAR_BOTTOM_PX = 120;

const isNearBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

/**
 * The message log. Renders the opening narration, each turn, the live
 * streaming beat, and — tethered under the latest beat — the AI options and
 * quick actions (loom-turn-protocol: options ride the same beat, above the
 * party strip). Tapping the latest beat reveals its controls: Regen/Edit/Undo
 * on the narrator beat, Edit on the player beat.
 *
 * Scroll behaviour: the log opens on the newest beat, follows the tail while
 * the reader is parked there, and — once they scroll up into the history —
 * stops following and offers a "↓ Latest" button back to the live edge.
 */
export function ChatView() {
  const opening = useStore((s) => s.game.scenario.openingNarration);
  const messages = useStore((s) => s.game.messages);
  // Every character, not just the party: scrollback dialogue must keep its
  // speaker styling after someone has been kicked or has left.
  const party = useStore((s) => s.game.characters);
  const streaming = useStore((s) => s.streaming);
  const streamText = useStore((s) => s.streamText);
  const error = useStore((s) => s.error);
  const failedInput = useStore((s) => s.failedInput);
  const retryTurn = useStore((s) => s.retryTurn);
  const editMessage = useStore((s) => s.editMessage);
  const editUserTurn = useStore((s) => s.editUserTurn);
  const hasKey = useStore((s) => Boolean(s.settings.openRouterKey.trim()));
  const setScreen = useStore((s) => s.setScreen);
  const textSize = useStore((s) => s.settings.textSize);

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
  // The newest narrator beat, so a beat taller than the viewport can be landed
  // on its FIRST line instead of its last (see the completion effect below).
  const latestBeatRef = useRef<HTMLDivElement>(null);
  // Whether the reader is parked at the live edge. Drives the jump-to-latest
  // button (shown only while reading back through the history).
  const [atBottom, setAtBottom] = useState(true);

  const jumpToLatest = (behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setAtBottom(true);
  };

  // On start (and on every return from a full-screen overlay, which remounts
  // this log) land on the newest beat rather than the first turn. Layout effect
  // so the jump happens before paint — no flash of the top of the history.
  useLayoutEffect(() => {
    jumpToLatest("auto");
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setAtBottom(isNearBottom(el));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Only follow the tail when the reader is already near the bottom — scrolling
  // up to reread must not get yanked back on every streaming delta. The bottom
  // marker sits below the quick actions, so following it keeps them in view.
  //
  // The exception is a COMPLETED beat that is taller than the viewport: pinning
  // its end puts the player at the last paragraph of prose they have not read
  // yet, with the options pushing the opening line off the top. There, land on
  // the beat's first line instead and let them read down into the options.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = isNearBottom(el);
    if (nearBottom) {
      const beat = latestBeatRef.current;
      if (!streaming && beat && beat.getBoundingClientRect().height > el.clientHeight) {
        beat.scrollIntoView({ block: "start" });
      } else {
        bottomRef.current?.scrollIntoView({ block: "end" });
      }
    }
    setAtBottom(isNearBottom(el));
  }, [messages.length, streamText, error, streaming]);

  const toggle = (id: string) => {
    if (editing) return;
    setActive((a) => (a === id ? null : id));
  };

  return (
    <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
      {/*
        Reading size for narration only, in the player's own pixels. It sits on
        this container and nowhere else, so chrome (buttons, chips, labels —
        all of which set their own Tailwind size) keeps its dimensions and a
        large setting buys prose rather than a blown-up interface.
      */}
      <section
        ref={scrollRef}
        style={{ fontSize: `${textSize}px` }}
        className="flex-1 space-y-4 overflow-y-auto px-3 pb-3"
      >
        <Beat role="narrator" text={opening} party={party} />

        {messages.map((m, i) => {
          const tappable = m.id === lastNarratorId || m.id === lastPlayerId;
          const isEditing = editing?.id === m.id;
          return (
            <div
              key={m.id}
              ref={m.id === lastNarratorId ? latestBeatRef : undefined}
              className="space-y-2"
            >
              <SceneMark msg={m} prev={messages[i - 1]} />
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
                  className="min-h-11 w-full border-2 border-ink text-xs uppercase tracking-widest opacity-70 active:bg-ink active:text-paper active:opacity-100"
                >
                  ✎ Edit
                </button>
              )}
            </div>
          );
        })}

        {streaming && <Beat role="narrator" text={streamText || "…"} party={party} pending />}

        {/*
          Narrator beat controls. Tapping the beat still reveals them, but that
          was the ONLY way in — an unhinted tap on a plain <div>, which meant
          Regen / Edit / Undo were invisible to a new player and unreachable
          entirely by keyboard or screen reader. This button is the discoverable,
          focusable path to the same thing.
        */}
        {!streaming && lastNarratorId && editing?.id !== lastNarratorId && (
          active === lastNarratorId ? (
            <TurnControls
              onEdit={() => {
                const m = messages.find((x) => x.id === lastNarratorId);
                if (m) setEditing({ id: m.id, role: "narrator", draft: m.content });
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setActive(lastNarratorId)}
              className="min-h-11 w-full border-2 border-dashed border-ink text-xs uppercase tracking-widest opacity-50 active:bg-ink active:text-paper active:opacity-100"
            >
              ⋯ Turn options
            </button>
          )
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
                className="min-h-11 w-full border-2 border-ink uppercase tracking-widest active:bg-ink active:text-paper"
              >
                ↻ Retry
              </button>
            )}
            {!hasKey && (
              <button
                type="button"
                onClick={() => setScreen("modelkey")}
                className="min-h-11 w-full border-2 border-ink uppercase tracking-widest active:bg-ink active:text-paper"
              >
                ☰ Model &amp; Key
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </section>

      {/* Jump to latest — only while reading back through the history. Floats
          over the log's bottom edge so it never displaces a beat. */}
      {!atBottom && (
        <button
          type="button"
          onClick={() => jumpToLatest()}
          className="absolute bottom-2 right-3 z-10 border-2 border-ink bg-paper px-3 py-1 text-xs uppercase tracking-widest active:bg-ink active:text-paper"
        >
          ↓ Latest
        </button>
      )}
    </div>
  );
}

/**
 * A rule naming the place and day, drawn only where they CHANGE. Every message
 * has carried `day`/`location` since Phase 5 and nothing ever rendered them, so
 * scrolling back through a long game gave no clue where or when a beat
 * happened. Messages written before that carry neither and simply get no mark.
 */
function SceneMark({ msg, prev }: { msg: Message; prev?: Message }) {
  if (!msg.location && msg.day === undefined) return null;
  // First marked message in the log always earns one; after that, only changes.
  const movedTo = msg.location && msg.location !== prev?.location ? msg.location : "";
  const newDay = msg.day !== undefined && msg.day !== prev?.day ? msg.day : undefined;
  if (!movedTo && newDay === undefined) return null;

  const label = [movedTo, newDay !== undefined ? `Day ${newDay}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-2 pt-2 text-xs uppercase tracking-widest opacity-60">
      <span className="h-0 flex-1 border-t-2 border-ink" />
      <span>{label}</span>
      <span className="h-0 flex-1 border-t-2 border-ink" />
    </div>
  );
}

/**
 * Chip row for one narrator beat: the rolled outcome (when stakes decided this
 * turn) followed by the state changes it applied. The outcome leads because it
 * is why the beat went the way it did — the rest is bookkeeping.
 *
 * The chip shows the arithmetic, not just the verdict: a bare "It cost you"
 * read as the app editorialising about the beat, where `1d6 1 -1 = 0` reads as
 * a die that went badly — and shows Flaws doing something. Turns recorded
 * before the roll was kept still show their band alone.
 */
function Toasts({ msg }: { msg: Message }) {
  const toasts = deriveToasts(msg);
  // The scale is read off the CURRENT system (RPG System) — the thresholds a
  // turn was banded under aren't recorded, and the live ones are what the next
  // roll will be read against anyway.
  const scale = useStore((s) => bandScale(s.settings));
  if (!toasts.length && !msg.outcome) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {msg.outcome && (
        <span
          className="border-2 border-ink bg-ink px-2 py-0.5 text-xs uppercase tracking-widest text-paper"
          title={msg.roll ? `${modifierNote(msg.roll)} — ${scale}` : scale}
        >
          ◆ {OUTCOME_LABEL[msg.outcome]}
          {msg.roll && ` · ${formatRoll(msg.roll)}`}
        </span>
      )}
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
          className="min-h-11 flex-1 border-2 border-ink active:bg-ink active:text-paper"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 border-2 border-ink opacity-70 active:bg-ink active:text-paper active:opacity-100"
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
    // Not uppercased: a player line can be a full sentence, and uppercase
    // monospace is the hardest thing on the page to read. The `>` and the rule
    // already mark it as the player's.
    return (
      <p className="whitespace-pre-wrap border-l-2 border-ink pl-2 leading-[1.4] tracking-wide opacity-80">
        &gt; {text}
      </p>
    );
  }

  // Segment narrator prose so party dialogue (`Name: "…"`) renders distinctly.
  // Leading is deliberately loose for monospace: at 1.3 a beat is a solid block
  // of glyphs, and this is a reading app before it is anything else.
  const segments = segmentDialogue(text, party);
  return (
    <div className={`space-y-3 leading-[1.6] ${pending ? "opacity-70" : ""}`}>
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
