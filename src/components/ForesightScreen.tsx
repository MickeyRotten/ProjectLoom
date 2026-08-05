import { useState } from "react";
import type { Arc, Front, RoomCard } from "../types";
import { useStore } from "../store";
import { SubMenuScreen, MenuLink, type SubMenuSection } from "./SubMenuScreen";
import { GenerateModal } from "./GenerateModal";
import { AreaField, Field, LinesField, Section, TextField, btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";
import { MAX_CLOCK, MIN_CLOCK, clockFace, nextStep } from "../lib/fronts";
import { clampArcSteps } from "../lib/settings";
import { runningArc } from "../lib/arc";
import { AREA_MAX_THREATS, type ParsedAreaCard } from "../lib/areaPrep";
import { ROOM_MAX_HOOKS, ROOM_MAX_THREATS, type ParsedRoomCard } from "../lib/roomPrep";
import { areaIsStale, currentArea, currentRoom, roomIsStale } from "../lib/gazetteer";

/**
 * This adventure's forward prep, made visible (DESIGN.md → Foresight).
 *
 * Everything here is normally written by the narrator at a boundary and read
 * back into the prompt without the player ever seeing it. This screen is the
 * same argument the Journal screen makes: material the app keeps and feeds to a
 * model has to be readable and editable, or a fact it quietly got wrong is
 * unfixable.
 *
 * Four sub-menus, widest scope first — **Arc** (the question, the one front and
 * its clock, and the ✦ controls that write both), **Region**, **Room**,
 * **Promises**.
 *
 * All three scopes now work the same way, and it is the way the rest of the app
 * already authors text: a ✦ button opens the shared `GenerateModal` — guidance
 * in, a preview back, Use This / Generate Again — and everything it writes is an
 * ordinary editable field afterwards. Nothing is applied by generating; the
 * region and the room in play are untouched until the player accepts.
 */

/** Blank when Foresight is switched off — the one thing worth saying then. */
function OffNotice() {
  const on = useStore((s) => s.settings.foresightEnabled);
  if (on) return null;
  return (
    <p className="border-2 border-ink p-3 text-xs uppercase tracking-widest opacity-70">
      Foresight is off —{" "}
      <MenuLink screen="narrator" section="foresight">
        Narrator → Foresight
      </MenuLink>
      . Everything below is kept and comes back when it is switched on.
    </p>
  );
}

/** The pending / failed line every sub-menu shows. */
function PrepStatus() {
  const pending = useStore((s) => s.foresightPending);
  const error = useStore((s) => s.foresightError);
  const clear = useStore((s) => s.clearForesightError);
  if (pending) {
    return <p className="text-xs uppercase tracking-widest opacity-70">Preparing…</p>;
  }
  if (!error) return null;
  return (
    <button
      type="button"
      onClick={clear}
      className="block w-full border-2 border-ink p-2 text-left text-xs"
    >
      {error}
      <span className="ml-2 uppercase tracking-widest opacity-60">tap to dismiss</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Arc
 * ------------------------------------------------------------------ */

/**
 * The front: its label, its clock, the step it is about to reach, and manual
 * ± on the ticks.
 *
 * The manual ticks are deliberate. Every clock in this app is client-owned
 * precisely so nothing can move one behind the player's back — which makes the
 * player the one party who is allowed to.
 */
function FrontRow({ front }: { front: Front }) {
  const updateArc = useStore((s) => s.updateArc);

  const write = (patch: Partial<Front>) => updateArc({ front: { ...front, ...patch } });

  const setTicks = (ticks: number) =>
    write({
      ticks: Math.max(0, Math.min(front.steps.length, ticks)),
      // Moving the clock by hand to its end IS firing it: the arrival block is
      // read off `status`, so the two must not disagree.
      status: ticks >= front.steps.length ? "fired" : "open",
    });

  return (
    <div className="space-y-2 border-2 border-ink p-3">
      <TextField
        label="What Is Closing In"
        value={front.label}
        onChange={(v) => write({ label: v })}
        placeholder="the mine floods"
      />

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest opacity-60">{front.status}</span>
        <span className="tracking-widest" aria-label={`${front.ticks} of ${front.steps.length}`}>
          {clockFace(front)}
        </span>
        <button type="button" onClick={() => setTicks(front.ticks - 1)} className={btnSmall}>
          −
        </button>
        <button type="button" onClick={() => setTicks(front.ticks + 1)} className={btnSmall}>
          +
        </button>
      </div>

      {front.status === "open" && (
        <p className="text-sm opacity-70">Next: {nextStep(front)}</p>
      )}

      <LinesField
        label="Steps"
        value={front.steps}
        onChange={(steps) => write({ steps })}
        note={
          <p className="text-xs opacity-70">
            One step per line, worst last. The narrator is only ever shown the next one.
          </p>
        }
      />
    </div>
  );
}

/**
 * The two inputs to every arc the model writes, edited where they are spent
 * rather than in the Foresight settings: free-text direction, and how many steps
 * the front gets — which is how long the chapter runs.
 *
 * Both are `Settings` keys, so they persist and the interlude's automatic
 * handoff writes to them too. Blank guidance adds no block at all, exactly the
 * way a blank instruction field removes a rule.
 */
function ArcGeneration({ label }: { label: string }) {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const write = useStore((st) => st.stageNextArc);
  const pending = useStore((st) => st.foresightPending);
  const enabled = useStore((st) => st.settings.foresightEnabled);

  return (
    <>
      <AreaField
        label="Guidance"
        value={s.arcGuidance}
        rows={2}
        onChange={(v) => update({ arcGuidance: v })}
        placeholder="Anything you want from the next chapter — leave blank and it decides"
      />

      <Field label="Steps">
        <input
          type="number"
          inputMode="numeric"
          min={MIN_CLOCK}
          max={MAX_CLOCK}
          step={1}
          value={s.arcSteps}
          onChange={(e) => update({ arcSteps: clampArcSteps(e.target.valueAsNumber) })}
          className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
        />
        <p className="text-xs opacity-70">
          How many steps the threat takes before it arrives — the length of the chapter.
          {" "}
          {MIN_CLOCK}–{MAX_CLOCK}.
        </p>
      </Field>

      <button
        type="button"
        onClick={() => void write(true)}
        disabled={pending || !enabled}
        className={`w-full ${btn}`}
      >
        ✦ {label}
      </button>
      <p className="text-xs opacity-70">
        Written from the scenario, your cast and what has happened so far. Everything it
        writes is editable here afterwards.
      </p>
    </>
  );
}

/**
 * The staged arc — Use / Generate Again, the `GenerateModal` shape one level up
 * (this one has to persist between visits to the screen, so it lives in the
 * document rather than in a modal's local state).
 *
 * Two modes, and they are the two things "regenerate an arc" can mean. In an
 * **interlude** the chapter is over and this is the NEXT one, opened beside it.
 * On a **running** arc the player did not want the chapter they are in, so
 * accepting REPLACES it in place — same seat, new question, new clock, and every
 * region prepared afresh because the epoch moves with it.
 */
function StagedArc({ arc }: { arc: Arc }) {
  const apply = useStore((s) => s.applyStagedArc);
  const discard = useStore((s) => s.discardStagedArc);
  const pending = useStore((s) => s.foresightPending);
  const { ask, dialog } = useConfirm();
  const staged = arc.staged;
  const interlude = arc.status === "interlude";

  function use() {
    if (interlude) {
      apply();
      return;
    }
    ask(
      {
        title: "Replace this chapter?",
        body: "The question and the front you are playing are written over, the clock starts again from zero, and every region is prepared afresh. What has already happened is untouched.",
        confirmLabel: "Replace",
      },
      apply,
    );
  }

  return (
    <div className="space-y-3 border-2 border-ink p-3">
      <Section label={interlude ? "The Next Chapter" : "A Different Chapter"} />
      {staged ? (
        <>
          <p className="text-sm">{staged.question || "—"}</p>
          {staged.front && <p className="text-sm opacity-70">· {staged.front.label}</p>}
          <button type="button" onClick={use} disabled={pending} className={`w-full ${btn}`}>
            Use This
          </button>
          <button type="button" onClick={discard} disabled={pending} className={btnSmall}>
            Discard
          </button>
        </>
      ) : (
        <p className="text-sm opacity-70">
          {interlude
            ? "Nothing written yet. It arrives on its own during the interlude — or ask for it now."
            : "Ask for a different chapter. Nothing changes until you use it."}
        </p>
      )}
      <ArcGeneration
        label={staged ? "Generate Again" : interlude ? "Write The Next Arc" : "Rewrite This Arc"}
      />
      {interlude && (
        <p className="text-xs opacity-70">
          If you never open this, whatever is written here starts by itself when the
          interlude runs out.
        </p>
      )}
      {dialog}
    </div>
  );
}

function ArcSection() {
  const arcs = useStore((s) => s.game.arcs) ?? [];
  const updateArc = useStore((s) => s.updateArc);
  const endInterlude = useStore((s) => s.endInterlude);
  const arc = runningArc(arcs);
  const past = arcs.filter((a) => a.status === "done");

  if (!arc) {
    return (
      <>
        <OffNotice />
        <PrepStatus />
        <p className="uppercase tracking-widest opacity-60">No arc yet.</p>
        <p className="text-xs opacity-70">
          An arc is what this chapter of the story is about, plus the one thing closing in
          on you while it runs. Regions and rooms are still prepared without one — this is
          the layer above them, and it is what makes a threat get closer while you are
          elsewhere.
        </p>
        <ArcGeneration label="Write An Arc" />
      </>
    );
  }

  return (
    <>
      <OffNotice />
      <PrepStatus />

      <TextField
        label="The Question"
        value={arc.question}
        onChange={(v) => updateArc({ question: v })}
        placeholder="What this chapter is about"
      />

      {/* In an interlude the handoff IS the screen's business, so it comes
          first. On a running arc the rewrite is a way out of the chapter in
          hand — it belongs under the chapter, not above it. */}
      {arc.status === "interlude" && (
        <>
          <p className="border-2 border-ink p-3 text-sm">
            <span className="uppercase tracking-widest">Interlude.</span> The chapter has
            closed. Nothing is looming and no clock is running — room to talk, rest and
            regroup.
          </p>
          <StagedArc arc={arc} />
          <button type="button" onClick={endInterlude} className={`w-full ${btn}`}>
            Move On Now
          </button>
        </>
      )}

      <Section label="The Front" />
      {arc.front ? (
        <FrontRow front={arc.front} />
      ) : (
        <p className="text-xs uppercase tracking-widest opacity-60">None.</p>
      )}
      <p className="text-xs opacity-70">
        The front advances when a roll costs you something — anywhere, it is not tied to
        one place — and on its own if it is left alone too long. When it arrives, the
        chapter ends.
      </p>

      {arc.status !== "interlude" && <StagedArc arc={arc} />}

      {past.length > 0 && (
        <>
          <Section label="Past Chapters" />
          {past.map((a) => (
            <div key={a.id} className="border-2 border-ink p-3 text-sm">
              <p>{a.question || "—"}</p>
              <p className="mt-1 text-xs uppercase tracking-widest opacity-60">
                opened turn {a.openedTurn}
              </p>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Region + Room
 * ------------------------------------------------------------------ */

/** The ✦ button both card scopes carry, and the modal it opens. */
function PrepButton<T>({
  label,
  what,
  blurb,
  written,
  replacingNote,
  disabled,
  run,
  preview,
  onAccept,
}: {
  /** The button's own words — "Write This Region Again". */
  label: string;
  /** What is being written, for the modal's title. */
  what: string;
  blurb: string;
  written: boolean;
  replacingNote: string;
  disabled?: boolean;
  run: (hint: string) => Promise<T | null>;
  preview: (result: T) => React.ReactNode;
  onAccept: (result: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`w-full ${btn}`}
      >
        ✦ {label}
      </button>
      {open && (
        <GenerateModal<T>
          label={what}
          blurb={blurb}
          replacing={written}
          replacingNote={replacingNote}
          run={run}
          preview={preview}
          onAccept={onAccept}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AreaSection() {
  const game = useStore((s) => s.game);
  const update = useStore((s) => s.updateArea);
  const generate = useStore((s) => s.generateAreaCard);
  const apply = useStore((s) => s.applyAreaCard);
  const area = currentArea(game);
  const arc = runningArc(game.arcs);
  const written = Boolean(area?.texture || area?.threats.length);

  return (
    <>
      <OffNotice />
      <PrepStatus />

      {!area ? (
        <>
          <p className="uppercase tracking-widest opacity-60">No region yet.</p>
          <p className="text-xs opacity-70">
            A region is named by the scenario's{" "}
            <MenuLink screen="scenario">Starting Region</MenuLink> and by the narrator
            when the story walks into a new one.
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold">{area.name}</p>
          {!written && (
            <p className="text-xs uppercase tracking-widest opacity-60">
              Nothing prepared here yet.
            </p>
          )}
          {areaIsStale(area, arc) && (
            <p className="border-2 border-ink p-2 text-xs uppercase tracking-widest">
              Out of date — the story has moved since this was written. It is prepared
              again next time you walk in.
            </p>
          )}

          <AreaField
            label="What This Region Is"
            value={area.texture}
            rows={3}
            placeholder="The look, the weather, who moves through it, what state it is in"
            onChange={(texture) => update({ texture })}
          />

          <LinesField
            label="Standing Threats"
            value={area.threats}
            limit={AREA_MAX_THREATS}
            placeholder="what applies anywhere in the region"
            onChange={(threats) => update({ threats })}
            note={
              <p className="text-xs opacity-70">
                One per line, at most {AREA_MAX_THREATS}. Standing conditions with teeth,
                not events.
              </p>
            }
          />

          <Section label="Places Here" />
          <ul className="space-y-1 text-sm">
            {Object.values(area.rooms).map((room) => (
              <li key={room.name} className={room.visited ? "" : "opacity-60"}>
                · {room.name}
                {room.visited ? "" : " (never visited)"}
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-70">
            The map's skeleton — names only. Writing the region again replaces this
            list: the places you have walked into stay, the ones you have not are
            dropped with the version of the region that named them.
          </p>
        </>
      )}

      <PrepButton<ParsedAreaCard>
        label={written ? "Write This Region Again" : "Write This Region"}
        what="Region"
        blurb="Written from the scenario, the arc, the lore your guidance touches and the promises still outstanding. Everything it writes is editable here afterwards."
        written={written}
        replacingNote="Replaces what is written above, the list of places included — only the ones you have already walked into stay on the map."
        disabled={!game.areaKey}
        run={generate}
        preview={(card) => (
          <>
            <p>{card.texture || "—"}</p>
            {card.threats.length > 0 && (
              <p className="mt-2">standing: {card.threats.join(" · ")}</p>
            )}
            {card.rooms.length > 0 && (
              <p className="mt-2 opacity-70">places: {card.rooms.join(" · ")}</p>
            )}
          </>
        )}
        onAccept={apply}
      />
    </>
  );
}

/** What an unprepped room's fields show before anything is written into them. */
const BLANK_ROOM: Pick<RoomCard, "danger" | "threats" | "hooks"> = {
  danger: "",
  threats: [],
  hooks: [],
};

function RoomSection() {
  const game = useStore((s) => s.game);
  const update = useStore((s) => s.updateRoom);
  const generate = useStore((s) => s.generateRoomCard);
  const apply = useStore((s) => s.applyRoomCard);
  const area = currentArea(game);
  const room = currentRoom(game);
  // Editable whether or not anything has prepped this place: `updateRoom`
  // creates the card on the first keystroke, so a player can author a room the
  // model has never seen — the bargain the Journal screen already makes.
  const card = room?.card ?? BLANK_ROOM;
  const written = Boolean(room?.card);

  return (
    <>
      <OffNotice />
      <PrepStatus />

      <p className="text-lg font-bold">{room?.name || game.location}</p>

      {!written && (
        <p className="text-xs uppercase tracking-widest opacity-60">
          Nothing prepared here yet.
        </p>
      )}
      {area && roomIsStale(area, room) && (
        <p className="border-2 border-ink p-2 text-xs uppercase tracking-widest">
          Out of date — its region was prepared again after this was written.
        </p>
      )}

      <AreaField
        label="What This Place Is"
        value={card.danger}
        rows={3}
        placeholder="The shape of it, the sightlines, what it does to somebody standing in it"
        onChange={(danger) => update({ danger })}
      />

      <LinesField
        label="Threats"
        value={card.threats}
        limit={ROOM_MAX_THREATS}
        placeholder="the thing, and what sets it off"
        onChange={(threats) => update({ threats })}
        note={
          <p className="text-xs opacity-70">One per line, at most {ROOM_MAX_THREATS}.</p>
        }
      />

      <LinesField
        label="Here To Want"
        value={card.hooks}
        limit={ROOM_MAX_HOOKS}
        placeholder="what is here worth having"
        onChange={(hooks) => update({ hooks })}
        note={<p className="text-xs opacity-70">One per line, at most {ROOM_MAX_HOOKS}.</p>}
      />

      <PrepButton<ParsedRoomCard>
        label={written ? "Write This Place Again" : "Write This Place"}
        what="Room"
        blurb="Written from the region, the last two beats, your party's flaws and the lore your guidance touches. Everything it writes is editable here afterwards."
        written={written}
        replacingNote="Replaces what is written above. The ways out join the map."
        disabled={!area}
        run={generate}
        preview={(c) => (
          <>
            <p>{c.danger || "—"}</p>
            {c.threats.length > 0 && <p className="mt-2">threats: {c.threats.join(" · ")}</p>}
            {c.hooks.length > 0 && <p className="mt-2">here to want: {c.hooks.join(" · ")}</p>}
            {c.exits.length > 0 && (
              <p className="mt-2 opacity-70">ways out: {c.exits.join(" · ")}</p>
            )}
          </>
        )}
        onAccept={apply}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Promises
 * ------------------------------------------------------------------ */

function PromisesSection() {
  const promises = useStore((s) => s.game.promises) ?? [];
  const turn = useStore((s) => s.game.turnNumber);
  const close = useStore((s) => s.closePromise);
  const { ask, dialog } = useConfirm();

  return (
    <>
      <OffNotice />
      <p className="text-xs opacity-70">
        Things the narration has committed to and not yet delivered. They come back to it
        every turn until they are paid off — or until they get old enough to drop.
      </p>

      {promises.length === 0 && (
        <p className="uppercase tracking-widest opacity-60">Nothing outstanding.</p>
      )}

      {[...promises].reverse().map((p) => (
        <div key={p.id} className="space-y-2 border-2 border-ink p-3">
          <p className="text-sm">{p.text}</p>
          <p className="text-xs uppercase tracking-widest opacity-60">
            planted turn {p.plantedTurn} · {Math.max(0, turn - p.plantedTurn)} turns ago
          </p>
          <button
            type="button"
            className={btnSmall}
            onClick={() =>
              ask({ title: "Drop this promise?", body: p.text, confirmLabel: "Drop" }, () =>
                close(p.id),
              )
            }
          >
            Drop
          </button>
        </div>
      ))}
      {dialog}
    </>
  );
}

const SECTIONS: SubMenuSection[] = [
  { id: "arc", label: "Arc", note: "The question · what is closing in", Body: ArcSection },
  { id: "area", label: "Region", note: "Where you are, and what it is like", Body: AreaSection },
  { id: "room", label: "Room", note: "This place, and what a roll costs here", Body: RoomSection },
  { id: "promises", label: "Promises", note: "Set up and not yet paid off", Body: PromisesSection },
];

export function ForesightScreen() {
  return <SubMenuScreen title="Foresight" sections={SECTIONS} />;
}
