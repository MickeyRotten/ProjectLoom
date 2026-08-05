import type { Arc, Front } from "../types";
import { useStore } from "../store";
import { SubMenuScreen, MenuLink, type SubMenuSection } from "./SubMenuScreen";
import { AreaField, Section, TextField, btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";
import { clockFace, nextStep } from "../lib/fronts";
import { runningArc } from "../lib/arc";
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
 * Four sub-menus, widest scope first — **Arc** (the question, the fronts, and
 * their clocks), **Region**, **Room**, **Promises**.
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
 * One front: its label, its clock, the step it is about to reach, and manual
 * ± on the ticks.
 *
 * The manual ticks are deliberate. Every clock in this app is client-owned
 * precisely so nothing can move one behind the player's back — which makes the
 * player the one party who is allowed to.
 */
function FrontRow({ arc, front }: { arc: Arc; front: Front }) {
  const updateArc = useStore((s) => s.updateArc);
  const spine = arc.spine === front.id;

  const write = (patch: Partial<Front>) =>
    updateArc({
      fronts: arc.fronts.map((f) => (f.id === front.id ? { ...f, ...patch } : f)),
    });

  const setTicks = (ticks: number) =>
    write({
      ticks: Math.max(0, Math.min(front.steps.length, ticks)),
      // Moving the clock by hand to its end IS firing it: the arrival block is
      // read off `status`, so the two must not disagree.
      status: ticks >= front.steps.length ? "fired" : "open",
    });

  return (
    <div className="space-y-2 border-2 border-ink p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold">{front.label}</span>
        <span className="text-xs uppercase tracking-widest opacity-60">
          {spine ? "spine" : front.status}
        </span>
      </div>

      <div className="flex items-center gap-2">
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

      <AreaField
        label="Steps"
        value={front.steps.join("\n")}
        rows={Math.max(2, front.steps.length)}
        onChange={(v) =>
          write({ steps: v.split("\n").map((s) => s.trim()).filter(Boolean) })
        }
      />
      <p className="text-xs opacity-70">
        One step per line, worst last. The narrator is only ever shown the next one.
      </p>
    </div>
  );
}

/** The staged next arc — Use / Regenerate, the `GenerateModal` shape one level up. */
function StagedArc({ arc }: { arc: Arc }) {
  const stage = useStore((s) => s.stageNextArc);
  const apply = useStore((s) => s.applyStagedArc);
  const pending = useStore((s) => s.foresightPending);
  const staged = arc.staged;

  return (
    <div className="space-y-3 border-2 border-ink p-3">
      <Section label="The Next Chapter" />
      {staged ? (
        <>
          <p className="text-sm">{staged.question || "—"}</p>
          <ul className="space-y-1 text-sm opacity-70">
            {staged.fronts.map((f) => (
              <li key={f.id}>
                · {f.label}
                {f.id === staged.spine ? " (spine)" : ""}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={apply} disabled={pending} className={`flex-1 ${btn}`}>
              Use This
            </button>
            <button
              type="button"
              onClick={() => void stage(true)}
              disabled={pending}
              className={`flex-1 ${btn}`}
            >
              Generate Again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm opacity-70">
            Nothing written yet. It arrives on its own during the interlude — or ask for
            it now.
          </p>
          <button
            type="button"
            onClick={() => void stage(true)}
            disabled={pending}
            className={`w-full ${btn}`}
          >
            Write The Next Arc
          </button>
        </>
      )}
      <p className="text-xs opacity-70">
        If you never open this, whatever is written here starts by itself when the
        interlude runs out.
      </p>
    </div>
  );
}

/**
 * Write an arc from where the story already is — the scenario, the cast and the
 * journal. Offered when there is none, since otherwise the only thing that ever
 * writes one is a chapter ending, and a chapter cannot end without an arc to end
 * it.
 */
function WriteArcButton() {
  const write = useStore((s) => s.stageNextArc);
  const pending = useStore((s) => s.foresightPending);
  const enabled = useStore((s) => s.settings.foresightEnabled);
  return (
    <>
      <button
        type="button"
        onClick={() => void write(true)}
        disabled={pending || !enabled}
        className={`w-full ${btn}`}
      >
        Write An Arc
      </button>
      <p className="text-xs opacity-70">
        Written from the scenario, your cast and what has happened so far. Everything it
        writes is editable here afterwards.
      </p>
    </>
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
          An arc is what this chapter of the story is about, plus the things closing in on
          you while it runs. Regions and rooms are still prepared without one — this is the
          layer above them, and it is what makes a threat get closer while you are
          elsewhere.
        </p>
        <WriteArcButton />
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

      <Section label="Fronts" />
      {arc.fronts.length === 0 && (
        <p className="text-xs uppercase tracking-widest opacity-60">None.</p>
      )}
      {arc.fronts.map((front) => (
        <FrontRow key={front.id} arc={arc} front={front} />
      ))}
      <p className="text-xs opacity-70">
        A front advances when a roll costs you something in the region it is attached to,
        and on its own if it is left alone too long. The one marked <em>spine</em> ends
        the chapter when it arrives.
      </p>

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

function AreaSection() {
  const game = useStore((s) => s.game);
  const refresh = useStore((s) => s.refreshArea);
  const pending = useStore((s) => s.foresightPending);
  const area = currentArea(game);
  const arc = runningArc(game.arcs);

  return (
    <>
      <OffNotice />
      <PrepStatus />

      {!area ? (
        <p className="uppercase tracking-widest opacity-60">
          Nothing prepared for {game.location}.
        </p>
      ) : (
        <>
          <p className="text-lg font-bold">{area.name}</p>
          {areaIsStale(area, arc) && (
            <p className="border-2 border-ink p-2 text-xs uppercase tracking-widest">
              Out of date — the story has moved since this was written. It is prepared
              again next time you walk in.
            </p>
          )}
          <p className="text-sm">{area.texture || "—"}</p>

          <Section label="Standing Threats" />
          {area.threats.length ? (
            <ul className="space-y-1 text-sm">
              {area.threats.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs uppercase tracking-widest opacity-60">None.</p>
          )}

          <Section label="Places Here" />
          <ul className="space-y-1 text-sm">
            {Object.values(area.rooms).map((room) => (
              <li key={room.name} className={room.visited ? "" : "opacity-60"}>
                · {room.name}
                {room.visited ? "" : " (never visited)"}
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        type="button"
        onClick={refresh}
        disabled={pending || !game.areaKey}
        className={`w-full ${btn}`}
      >
        ↻ Prepare This Region Again
      </button>
    </>
  );
}

function RoomSection() {
  const game = useStore((s) => s.game);
  const refresh = useStore((s) => s.refreshRoom);
  const pending = useStore((s) => s.foresightPending);
  const area = currentArea(game);
  const room = currentRoom(game);
  const card = room?.card;

  return (
    <>
      <OffNotice />
      <PrepStatus />

      <p className="text-lg font-bold">{room?.name || game.location}</p>

      {!card ? (
        <p className="uppercase tracking-widest opacity-60">Nothing prepared here yet.</p>
      ) : (
        <>
          {area && roomIsStale(area, room) && (
            <p className="border-2 border-ink p-2 text-xs uppercase tracking-widest">
              Out of date — its region was prepared again after this was written.
            </p>
          )}
          <p className="text-sm">{card.danger || "—"}</p>

          <Section label="Threats" />
          {card.threats.length ? (
            <ul className="space-y-1 text-sm">
              {card.threats.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs uppercase tracking-widest opacity-60">None.</p>
          )}

          <Section label="Here To Want" />
          {card.hooks.length ? (
            <ul className="space-y-1 text-sm">
              {card.hooks.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs uppercase tracking-widest opacity-60">None.</p>
          )}

          <Section label="If You Roll Here" />
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="uppercase tracking-widest opacity-60">Strong</dt>
              <dd>{card.outcomes.strong || "—"}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-widest opacity-60">Mixed</dt>
              <dd>{card.outcomes.mixed || "—"}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-widest opacity-60">Cost</dt>
              <dd>{card.outcomes.cost || "—"}</dd>
            </div>
          </dl>
          <p className="text-xs opacity-70">
            Only the one your dice actually land on is ever shown to the narrator — the
            other two never reach it.
          </p>
        </>
      )}

      <button type="button" onClick={refresh} disabled={pending} className={`w-full ${btn}`}>
        ↻ Prepare This Place Again
      </button>
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
