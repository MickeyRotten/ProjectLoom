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

  return (
    <div className="relative aspect-[16/5] shrink-0 overflow-hidden border-b-2 border-ink">
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
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center uppercase tracking-widest opacity-50">
          <span>{pending ? "rendering banner…" : location}</span>
          {!pending && waiting > 0 && (
            <span className="text-[0.6rem]">
              new image in {waiting} {waiting === 1 ? "turn" : "turns"} · ⟳ draws now
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Regenerate banner"
        disabled={pending}
        onClick={regenerate}
        className="absolute right-1 top-1 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
      >
        ⟳
      </button>
      {url && (
        <EditImageButton
          label="Edit banner"
          disabled={pending}
          onSubmit={edit}
          className="absolute right-9 top-1 border-2 border-ink bg-paper px-2 leading-none disabled:opacity-40 active:bg-ink active:text-paper"
        />
      )}
      {imageError && !pending && (
        <button
          type="button"
          title={imageError}
          onClick={() => setShowWhy((v) => !v)}
          className="absolute bottom-1 right-1 max-w-[calc(100%-0.5rem)] border-2 border-ink bg-paper px-1 text-left text-[0.6rem] uppercase tracking-widest"
        >
          {showWhy ? imageError : "image failed"}
        </button>
      )}

      {zoom && url && (
        <button
          type="button"
          aria-label="Close full-screen location"
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3"
        >
          <img
            src={url}
            alt={location}
            className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
          />
        </button>
      )}
    </div>
  );
}
