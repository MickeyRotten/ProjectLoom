import { useState } from "react";
import { useStore } from "../store";
import { bannerCooldownLeft, bannerKey } from "../lib/images";
import { EditImageButton } from "./EditImageButton";

/**
 * The location banner (DESIGN.md → UI): a wide 1-bit establishing image for the
 * current location. Full-bleed — edge to edge, flush against the header, with
 * only a bottom rule separating it from the log — so the image reads as part of
 * the top bar instead of a floating card. Generated on a scene change to an
 * uncached location; a placeholder shows while it renders. Tap ⟳ to regenerate.
 */
export function Banner() {
  const location = useStore((s) => s.game.location);
  const key = bannerKey(location);
  const url = useStore((s) => s.images[key]);
  const pending = useStore((s) => s.imgPending[key]);
  const imageError = useStore((s) => s.imgError[key]);
  const regenerate = useStore((s) => s.regenerateBanner);
  // Turns left on the generation cooldown (Advanced). Without this the
  // placeholder is indistinguishable from a silently broken banner.
  const waiting = useStore((s) =>
    bannerCooldownLeft(s.settings.bannerCooldown, s.game.lastBannerTurn, s.game.turnNumber),
  );
  const edit = useStore((s) => s.editBanner);
  const [zoom, setZoom] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const size = useStore((s) => s.settings.bannerSize);
  const updateSettings = useStore((s) => s.updateSettings);

  // Compact: a thin strip that keeps the location and the art one tap away
  // (tapping opens the same full-screen view) while handing ~90px of a phone
  // back to the prose. The full banner + party strip + composer together were
  // taking more than half the viewport of a reading app.
  if (size === "compact") {
    return (
      <div className="flex shrink-0 items-stretch border-b-2 border-ink">
        <button
          type="button"
          disabled={!url}
          onClick={() => setZoom(true)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left disabled:opacity-100 active:bg-ink active:text-paper"
        >
          {url && (
            <img
              src={url}
              alt=""
              aria-hidden="true"
              className="h-6 w-10 shrink-0 border-2 border-ink object-cover [image-rendering:pixelated]"
            />
          )}
          <span className="truncate text-sm uppercase tracking-widest opacity-70">
            {pending ? "rendering banner…" : location}
          </span>
        </button>
        <button
          type="button"
          aria-label="Expand location image"
          onClick={() => updateSettings({ bannerSize: "full" })}
          className="min-h-11 min-w-11 border-l-2 border-ink px-3 active:bg-ink active:text-paper"
        >
          ▼
        </button>

        {zoom && url && <ZoomOverlay url={url} location={location} onClose={() => setZoom(false)} />}
      </div>
    );
  }

  // Full height is for ART. With nothing drawn and nothing coming — no key, no
  // image model, or a location that simply has not been generated — the full
  // box is 122px of a phone showing the location name the header already shows.
  // Keep the controls, drop the empty acreage.
  const hasArt = Boolean(url) || pending;

  return (
    <div
      className={`relative shrink-0 overflow-hidden border-b-2 border-ink ${
        hasArt ? "aspect-[16/5]" : "min-h-[3rem]"
      }`}
    >
      {url ? (
        <button
          type="button"
          aria-label="View location full screen"
          onClick={() => setZoom(true)}
          className="block h-full w-full active:opacity-60"
        >
          <img
            src={url}
            alt={location}
            className="h-full w-full object-cover [image-rendering:pixelated]"
          />
        </button>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-14 py-3 text-center uppercase tracking-widest opacity-50">
          <span className="truncate">{pending ? "rendering banner…" : location}</span>
          {!pending && waiting > 0 && (
            <span className="text-[0.6rem]">
              new image in {waiting} {waiting === 1 ? "turn" : "turns"} · ⟳ draws now
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Collapse location image"
        onClick={() => updateSettings({ bannerSize: "compact" })}
        className="absolute left-1 top-1 min-h-11 min-w-11 border-2 border-ink bg-paper px-2 leading-none active:bg-ink active:text-paper"
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="Regenerate banner"
        disabled={pending}
        onClick={regenerate}
        className="absolute right-1 top-1 min-h-11 min-w-11 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
      >
        ⟳
      </button>
      {url && (
        <EditImageButton
          label="Edit banner"
          disabled={pending}
          onSubmit={edit}
          className="absolute right-14 top-1 min-h-11 min-w-11 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
        />
      )}
      {imageError && !pending && (
        <button
          type="button"
          title={imageError}
          onClick={() => setShowWhy((v) => !v)}
          className="absolute bottom-1 right-1 max-w-[calc(100%-0.5rem)] border-2 border-ink bg-paper px-1 py-0.5 text-left text-xs uppercase tracking-widest"
        >
          {showWhy ? imageError : "image failed"}
        </button>
      )}

      {zoom && url && <ZoomOverlay url={url} location={location} onClose={() => setZoom(false)} />}
    </div>
  );
}

/** The tap-to-enlarge view, shared by both banner sizes. */
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
