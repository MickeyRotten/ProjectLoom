import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "../store";
import {
  PIP_LAYOUT,
  SCENE_TILT,
  TIMING,
  landedAt,
  leaveAt,
  planToss,
  totalMs,
} from "../lib/diceAnim";
import { OUTCOME_LABEL, formatRoll, modifierNote } from "../lib/stakes";
import type { DiceCast } from "../types";

/**
 * The dice toss — a 60% ink scrim over the whole game, dice thrown across it,
 * the result held for a beat on an opaque plate, then everything fades back out.
 * A scrim rather than a curtain: the beat the player just sent stays readable
 * underneath, so the roll happens IN the scene.
 *
 * It runs on the way IN to a turn, not after it: `sendTurn` rolls before it
 * calls the model, so the cast is staged while the request is still in flight
 * and the tumble plays over the wait for the first token. The narration is
 * usually still arriving when the layer clears.
 *
 * Nothing here decides anything. `stakes.ts` rolled, `diceAnim.ts` staged the
 * arcs, and this only plays them — the same result is on the beat's chip
 * afterwards whether the animation ran, was skipped, or is switched off
 * entirely (RPG System → Dice Animation).
 */

/** Square pips, on the 3×3 grid a die face actually uses. */
function Pips({ value }: { value: number }) {
  const layout = PIP_LAYOUT[value] ?? [];
  return (
    <span className="grid h-full w-full grid-cols-3 grid-rows-3 p-[14%]">
      {layout.map(([col, row], i) => (
        <span
          key={i}
          style={{ gridColumn: col, gridRow: row }}
          className="m-auto block h-[72%] w-[72%] bg-ink"
        />
      ))}
    </span>
  );
}

/**
 * One face. Pips for a six-sided die; the numeral for everything else, because
 * there is no pip layout for a 17 and inventing one would just be a shape.
 */
function Face({ value, pips }: { value: number; pips: boolean }) {
  if (pips) return <Pips value={value} />;
  return (
    <span style={{ fontSize: "calc(var(--die) * 0.42)" }} className="leading-none">
      {value}
    </span>
  );
}

/** Does the reader want less motion? Guarded for environments without matchMedia. */
function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function Toss({ cast }: { cast: DiceCast }) {
  const clearDice = useStore((s) => s.clearDice);
  const dice = useMemo(() => planToss(cast.roll), [cast.roll]);
  const reduced = useMemo(reducedMotion, []);

  // `entered` drives the fade-in (an opacity transition needs a frame at 0 to
  // transition FROM); `landed` reveals the total; `leaving` fades everything out.
  const [entered, setEntered] = useState(false);
  const [landed, setLanded] = useState(reduced);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const n = dice.length;
    const frame = requestAnimationFrame(() => setEntered(true));
    const timers = [
      window.setTimeout(() => setLanded(true), landedAt(n, reduced)),
      window.setTimeout(() => setLeaving(true), leaveAt(n, reduced)),
      window.setTimeout(() => clearDice(cast.id), totalMs(n, reduced)),
    ];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [cast.id, dice.length, reduced, clearDice]);

  const { roll } = cast;
  const note = modifierNote(roll);

  return (
    <div
      // A 60% ink scrim over the whole app rather than a solid layer: the beat
      // the player just sent stays legible underneath, so the dice land in the
      // scene instead of on a screen the game cut away to.
      //
      // Tapping anywhere ends it: an animation that plays every risky turn must
      // be dismissable without hunting for a button.
      className="fixed inset-0 z-50 bg-scrim text-paper"
      style={{
        opacity: entered && !leaving ? 1 : 0,
        transition: `opacity ${leaving ? TIMING.fadeOut : TIMING.fadeIn}ms linear`,
      }}
      onClick={() => clearDice(cast.id)}
      role="presentation"
    >
      <div
        className="loom-dice-scene"
        style={
          {
            "--die": "clamp(52px, 16vw, 84px)",
            /* Space between dice once they are collected. */
            "--gap": "10px",
            /* The collected row sits above the middle, clear of the result. */
            "--row-origin": "-16vh",
          } as CSSProperties
        }
      >
        {/*
         * The surface the dice land on, tilted away from the camera. One
         * rotation for all of them — they rest parallel on a common table, and
         * it is the table that sits at an angle. See `SCENE_TILT`.
         */}
        <div
          className="loom-dice-plane"
          style={
            {
              "--plane-x": `${SCENE_TILT.x}deg`,
              "--plane-y": `${SCENE_TILT.y}deg`,
            } as CSSProperties
          }
        >
          {dice.map((d, i) => (
            <div
              key={i}
              className="loom-die"
              style={
                {
                  // Off the bottom-left corner, where it is thrown from.
                  "--dx": `${d.dx}vw`,
                  "--dy": `${d.dy}vh`,
                  // Where the throw scatters it to…
                  "--sx": `${d.sx}vw`,
                  "--sy": `${d.sy}vh`,
                  // …and where it is collected, a whole number of dice-widths
                  // from the middle of the row.
                  "--gx": `calc(${d.col} * (var(--die) + var(--gap)))`,
                  "--gy": `calc(var(--row-origin) + ${d.row} * (var(--die) + var(--gap)))`,
                  "--rx0": `${d.rx0}deg`,
                  "--ry0": `${d.ry0}deg`,
                  "--rx1": `${d.rx1}deg`,
                  "--ry1": `${d.ry1}deg`,
                  "--toss": `${TIMING.toss}ms`,
                  "--move": `${TIMING.move}ms`,
                  // Held until the layer itself has faded in, so nothing is thrown
                  // at a screen that is still half transparent.
                  "--delay": `${TIMING.fadeIn + d.delay}ms`,
                } as CSSProperties
              }
            >
              <div className="loom-die-cube">
                {d.faces.map((face, slot) => (
                  <div
                    key={slot}
                    className="loom-die-face"
                    // The six slots of the cube, in the order `diceAnim.ts`
                    // plans them: front, back, right, left, top, bottom.
                    style={{
                      transform: [
                        "translateZ(calc(var(--die) / 2))",
                        "rotateY(180deg) translateZ(calc(var(--die) / 2))",
                        "rotateY(90deg) translateZ(calc(var(--die) / 2))",
                        "rotateY(-90deg) translateZ(calc(var(--die) / 2))",
                        "rotateX(90deg) translateZ(calc(var(--die) / 2))",
                        "rotateX(-90deg) translateZ(calc(var(--die) / 2))",
                      ][slot],
                    }}
                  >
                    <Face value={face} pips={d.pips} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
       * The arithmetic and the verdict, revealed only once the dice have
       * settled — reading the result off a die still in the air is the one thing
       * the animation exists to prevent. The block keeps its height throughout so
       * the dice don't jump when it appears.
       */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 flex min-h-[5.5rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 border-2 border-paper bg-ink px-4 py-3 text-center transition-opacity duration-200"
        style={{ opacity: landed ? 1 : 0 }}
        role="status"
        aria-live="polite"
      >
        <span className="text-sm uppercase tracking-widest opacity-80">
          {formatRoll(roll)}
        </span>
        <span className="text-base uppercase tracking-widest">
          {OUTCOME_LABEL[cast.outcome]}
        </span>
        {roll.modifier !== 0 && (
          <span className="text-xs uppercase tracking-widest opacity-60">{note}</span>
        )}
      </div>

      <span className="absolute inset-x-0 bottom-6 text-center text-xs uppercase tracking-widest opacity-70">
        Tap to skip
      </span>
    </div>
  );
}

/**
 * Mounted once, app-wide. Keyed on the cast id so a second roll re-runs the
 * whole thing from its first frame instead of inheriting the previous one's
 * finished animation state.
 */
export function DiceOverlay() {
  const cast = useStore((s) => s.dice);
  if (!cast) return null;
  return <Toss key={cast.id} cast={cast} />;
}
