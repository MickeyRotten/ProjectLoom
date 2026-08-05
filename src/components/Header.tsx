import { useMemo, useState } from "react";
import { useStore } from "../store";
import { bannerCooldownLeft, bannerKey, imagesAllowed, portraitKey } from "../lib/images";
import { playerCharacter } from "../lib/roster";
import type { PartyMember } from "../types";

/** Placeholder hit points. No health system exists yet — see below. */
const HEARTS = 6;

/**
 * The top bar — the PLAYER CHARACTER: a small square portrait, their name
 * beside it, a row of hearts under the name, and the menu button at the right
 * edge. When Location Images are on it is still drawn on top of the location
 * banner, which remains its background.
 *
 * It used to be the location bar: name of the place · day · menu. Both of those
 * facts are already in the reading area — `ChatView`'s scene marks rule off the
 * log with "Somewhere · Day 3" every time either one changes — so the bar was
 * spending the most valuable strip of a phone screen restating the line the
 * player had just read. The PC had no permanent place on screen at all; they
 * were one of four party-strip slots, which is backwards, since the strip is
 * who is IN the scene and the player never is not.
 *
 * The hearts are a PLACEHOLDER: six filled glyphs, drawn from nothing and
 * meaning nothing, holding the shape a future hit-point system would take. They
 * are `aria-hidden` precisely because of that — a screen reader announcing
 * "6 of 6 health" would be describing a mechanic this app does not have.
 *
 * Literal `#000`/`#fff`, not the ink/paper tokens, for everything that sits on
 * the art — the ONE place in the app that opts out of the token system, and it
 * has to: a generated banner is a real 1-bit bitmap that a custom palette does
 * NOT flip (see App.tsx), so tokens would put black text on a black photo the
 * moment the player chose dark paper. The bar's own contents inherit through
 * `border-current`/`currentColor`, so there is exactly one place per variant
 * that names a colour. With Location Images off the bar is the themed
 * ink-on-paper strip it always was.
 *
 * `bannerSize` still chooses between the double-height bar (`full`) and a
 * single-height one (`compact`) that keeps the art as a backdrop while handing
 * the reading area its pixels back.
 */
export function Header() {
  const location = useStore((s) => s.game.location);
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);

  const enabled = useStore((s) => s.settings.locationImages);
  const size = useStore((s) => s.settings.bannerSize);
  const updateSettings = useStore((s) => s.updateSettings);
  const key = bannerKey(location);
  const url = useStore((s) => s.images[key]);
  const pending = useStore((s) => s.imgPending[key]);
  const imageError = useStore((s) => s.imgError[key]);
  // Turns left on the generation cooldown (Images). Without this an empty bar
  // is indistinguishable from a silently broken one.
  // ...only while banners can be drawn at all: with image generation off the
  // wait never ends, so counting it down would be a lie told every turn.
  const waiting = useStore((s) =>
    imagesAllowed(s.settings)
      ? bannerCooldownLeft(s.settings.bannerCooldown, s.game.lastBannerTurn, s.game.turnNumber)
      : 0,
  );
  const [zoom, setZoom] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  // Hooks first — an early return above them would break hook order the moment
  // the setting is toggled mid-session.
  if (!enabled) {
    return (
      <header className="flex shrink-0 items-center justify-between gap-3 bg-ink px-3 py-2 text-paper">
        <PlayerBlock pc={pc} streaming={streaming} />
        <MenuButton streaming={streaming} onOpen={() => setScreen("menu")} light={false} />
      </header>
    );
  }

  const full = size !== "compact";

  return (
    <header
      className={`relative shrink-0 overflow-hidden border-b-2 border-ink bg-[#000] text-[#fff] ${
        full ? "h-[7.5rem]" : "h-[3.75rem]"
      }`}
    >
      {url && (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
        />
      )}
      {/* Tap the art to enlarge it. Sits under the controls and the bottom row,
          so it only ever catches taps on bare image. */}
      {url && (
        <button
          type="button"
          aria-label="View location full screen"
          onClick={() => setZoom(true)}
          className="absolute inset-0 h-full w-full active:opacity-60"
        />
      )}

      {/* Nothing drawn yet: say which of the two reasons it is. */}
      {full && !url && (
        <div className="absolute inset-x-0 top-0 flex h-[3.75rem] flex-col items-center justify-center gap-1 px-3 text-center text-sm uppercase tracking-widest opacity-60">
          {pending && <span className="truncate">rendering banner…</span>}
          {!pending && waiting > 0 && (
            <span className="text-[0.6rem]">
              new image in {waiting} {waiting === 1 ? "turn" : "turns"}
            </span>
          )}
        </div>
      )}

      {imageError && !pending && (
        <button
          type="button"
          title={imageError}
          onClick={() => setShowWhy((v) => !v)}
          className="absolute left-1 top-1 max-w-[60%] border-2 border-[#fff] bg-[#000]/70 px-1 py-0.5 text-left text-xs uppercase tracking-widest text-[#fff]"
        >
          {showWhy ? imageError : "image failed"}
        </button>
      )}

      {/* The bottom row sits DIRECTLY on the art — no scrim, no gradient. What
          was there before darkened the bottom of every banner to back two short
          words, which is a lot of picture spent on legibility.
          An OUTLINE buys the same legibility for none of it: `text-stroke` with
          `paint-order: stroke` traces black around each glyph and paints the
          white fill on top, so the name and the hearts survive a white patch of
          banner without hiding what is under it. Still strictly two tones, and
          still the literal `#000`/`#fff` everything on the art uses — the bitmap
          does not flip with the palette. */}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-1.5 ${
          url ? "[paint-order:stroke] [-webkit-text-stroke:3px_#000]" : ""
        }`}
      >
        <PlayerBlock pc={pc} streaming={streaming} />
        <div className="flex items-center gap-3 whitespace-nowrap">
          {!full && (
            <button
              type="button"
              aria-label="Expand location image"
              onClick={() => updateSettings({ bannerSize: "full" })}
              className="min-h-11 min-w-11 border-2 border-[#fff] px-2 leading-none active:bg-[#fff] active:text-[#000]"
            >
              ▼
            </button>
          )}
          <MenuButton streaming={streaming} onOpen={() => setScreen("menu")} light />
        </div>
      </div>

      {zoom && url && <ZoomOverlay url={url} location={location} onClose={() => setZoom(false)} />}
    </header>
  );
}

/**
 * Portrait · name · hearts. One button, because it is one subject: tapping
 * anywhere on it opens the PC's sheet, which is the only route to them now that
 * they are out of the party strip.
 *
 * Everything visible inherits its colour (`border-current`), so this renders
 * unchanged on the themed strip and on the banner — the two places disagree
 * about what "the foreground" is, and only the header knows which one it is in.
 */
function PlayerBlock({ pc, streaming }: { pc: PartyMember | undefined; streaming: boolean }) {
  const openMember = useStore((s) => s.openMember);
  const portrait = useStore((s) => (pc ? s.images[portraitKey(pc.id)] : undefined));
  if (!pc) return <span className="min-w-0 flex-1" />;

  return (
    <button
      type="button"
      disabled={streaming}
      onClick={() => openMember(pc.id)}
      aria-label={pc.name}
      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-40 active:opacity-60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border-2 border-current text-xs font-bold">
        {portrait ? (
          <img
            src={portrait}
            alt=""
            aria-hidden="true"
            className="h-full w-full origin-top scale-150 object-cover object-top [image-rendering:pixelated]"
          />
        ) : (
          initials(pc)
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate uppercase">{pc.name}</span>
        {/* Placeholder hit points — six full hearts, always. Hidden from
            assistive tech until they mean something. */}
        <span aria-hidden="true" className="text-xs leading-none tracking-widest">
          {"♥".repeat(HEARTS)}
        </span>
      </span>
    </button>
  );
}

function initials(c: PartyMember): string {
  return c.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The gear button. `light` is the on-the-art variant: literal white, because a
 * paper-token border vanishes into a white patch of a banner under a dark
 * palette.
 */
function MenuButton({
  streaming,
  onOpen,
  light,
}: {
  streaming: boolean;
  onOpen: () => void;
  light: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Settings"
      disabled={streaming}
      onClick={onOpen}
      className={`min-h-11 min-w-11 border-2 px-3 leading-none disabled:opacity-40 ${
        light
          ? "border-[#fff] text-[#fff] active:bg-[#fff] active:text-[#000]"
          : "border-paper active:bg-paper active:text-ink"
      }`}
    >
      =
    </button>
  );
}

/** The tap-to-enlarge view for the location art. */
function ZoomOverlay({
  url,
  location,
  onClose,
}: {
  url: string;
  location: string;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Close full-screen location"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3"
    >
      <img
        src={url}
        alt={location}
        className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
      />
    </button>
  );
}
