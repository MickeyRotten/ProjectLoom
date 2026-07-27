import { useState } from "react";
import { useStore } from "../store";
import { bannerCooldownLeft, bannerKey } from "../lib/images";
import { EditImageButton } from "./EditImageButton";

/**
 * The top bar — location · day · menu — and, when Location Images are on, the
 * location banner it is drawn on top of.
 *
 * The banner used to be its own strip below the header, which meant the
 * location name was printed twice within 60px of itself and the art cost the
 * reading area its full height. Merged, the bar doubles in height and the image
 * becomes its background: the label, the day and the menu button sit along the
 * bottom over a black gradient that reaches full alpha quickly, so the text
 * stays legible over whatever the image happens to be doing there.
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
  const edit = useStore((s) => s.editBanner);
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

      {/* ✎ only. Regenerate (⟳) and collapse (▲) are gone from the bar: sizing
          lives in Menu → Compact Location Image, and a redraw is a spend the
          player was never asking for from a button sitting on top of the art.
          Edit stays because it is the one control with no equivalent elsewhere.
          Tall bar only — the compact one is a single row with no free space. */}
      {full && url && (
        <div className="absolute right-1 top-1 flex gap-1">
          <EditImageButton
            label="Edit banner"
            disabled={pending}
            onSubmit={edit}
            className="min-h-11 min-w-11 border-2 border-[#fff] bg-[#000]/70 px-2 leading-none text-[#fff] disabled:opacity-40 active:bg-[#fff] active:text-[#000]"
          />
        </div>
      )}

      {/* Nothing drawn yet: say which of the two reasons it is. */}
      {full && !url && (
        <div className="absolute inset-x-0 top-0 flex h-[3.75rem] flex-col items-center justify-center gap-1 px-14 text-center text-sm uppercase tracking-widest opacity-60">
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

      {/* The scrim the bottom row reads against, painted separately so the row
          keeps its 44px touch targets without the darkening growing with it.
          Tall bar: opaque exactly as high as the row, then a 16px fade to
          nothing — a long soft ramp would grey out the whole picture, and the
          point of the merge was to show the picture. Compact bar: the row IS
          the bar, so a flat scrim keeps the art visible underneath instead. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 ${
          full
            ? "h-[4.5rem] bg-[linear-gradient(to_top,#000_0%,#000_78%,transparent_100%)]"
            : "top-0 bg-[#000]/75"
        }`}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-1.5">
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
