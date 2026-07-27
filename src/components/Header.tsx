import { useState } from "react";
import { useStore } from "../store";
import { bannerCooldownLeft, bannerKey } from "../lib/images";

/**
 * The top bar — location · day · menu — and, when Location Images are on, the
 * location banner it is drawn on top of.
 *
 * The banner used to be its own strip below the header, which meant the
 * location name was printed twice within 60px of itself and the art cost the
 * reading area its full height. Merged, the bar doubles in height and the image
 * becomes its background: the label, the day and the menu button sit along its
 * bottom edge directly on the art, with nothing painted behind them — the
 * gradient scrim that used to back them was darkening the bottom third of every
 * picture to make room for two short words.
 *
 * Literal `#000`/`#fff`, not the ink/paper tokens, for everything that sits on
 * the art — the ONE place in the app that opts out of the token system, and it
 * has to: a generated banner is a real 1-bit bitmap that the invert theme does
 * NOT flip (see App.tsx), so tokens would put black text on a black photo the
 * moment the player inverted. The gradient is black for the same reason. With
 * Location Images off the bar is exactly the themed strip it always was.
 *
 * `bannerSize` still chooses between the double-height bar (`full`) and a
 * single-height one (`compact`) that keeps the art as a backdrop while handing
 * the reading area its pixels back.
 */
export function Header() {
  const location = useStore((s) => s.game.location);
  const day = useStore((s) => s.game.day);
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  const enabled = useStore((s) => s.settings.locationImages);
  const size = useStore((s) => s.settings.bannerSize);
  const updateSettings = useStore((s) => s.updateSettings);
  const key = bannerKey(location);
  const url = useStore((s) => s.images[key]);
  const pending = useStore((s) => s.imgPending[key]);
  const imageError = useStore((s) => s.imgError[key]);
  // Turns left on the generation cooldown (Advanced). Without this an empty bar
  // is indistinguishable from a silently broken one.
  const waiting = useStore((s) =>
    bannerCooldownLeft(s.settings.bannerCooldown, s.game.lastBannerTurn, s.game.turnNumber),
  );
  const [zoom, setZoom] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  // Hooks first — an early return above them would break hook order the moment
  // the setting is toggled mid-session.
  if (!enabled) {
    return (
      <header className="flex shrink-0 items-center justify-between bg-ink px-3 py-2 text-paper">
        <span className="truncate uppercase">{location}</span>
        <div className="flex items-center gap-3 whitespace-nowrap">
          <span>Day {day}</span>
          <MenuButton streaming={streaming} onOpen={() => setScreen("menu")} light={false} />
        </div>
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

      {/* No controls on the art at all now — ✎ followed ⟳ and ▲ off the bar.
          A location banner is scenery the story replaces on its own every time
          the player moves; retouching one is not something worth a button
          parked permanently on top of the picture, and every glyph up there was
          costing the image the corner it sat in. */}

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
          was there before darkened the bottom of every banner (a flat black
          wash on the compact bar, a fast gradient on the tall one) to back two
          short words, which is a lot of picture spent on legibility.
          An OUTLINE buys the same legibility for none of it: `text-stroke` with
          `paint-order: stroke` traces black around each glyph and paints the
          white fill on top, so the label survives a white patch of banner
          without hiding what is under it. Still strictly two tones, and still
          the literal `#000`/`#fff` everything on the art uses — the bitmap does
          not flip with the invert theme. */}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-1.5 ${
          url ? "[paint-order:stroke] [-webkit-text-stroke:3px_#000]" : ""
        }`}
      >
        <button
          type="button"
          disabled={!url}
          onClick={() => setZoom(true)}
          className="min-w-0 flex-1 truncate text-left uppercase disabled:opacity-100"
        >
          {location}
        </button>
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
          <span>Day {day}</span>
          <MenuButton streaming={streaming} onOpen={() => setScreen("menu")} light />
        </div>
      </div>

      {zoom && url && <ZoomOverlay url={url} location={location} onClose={() => setZoom(false)} />}
    </header>
  );
}

/**
 * The gear button. `light` is the on-the-art variant: literal white, because a
 * paper-token border vanishes into a white patch of an inverted theme's banner.
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
