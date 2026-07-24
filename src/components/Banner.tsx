import { useState } from "react";
import { useStore } from "../store";
import { bannerKey } from "../lib/images";
import { EditImageButton } from "./EditImageButton";

/**
 * The location banner (DESIGN.md → UI): a wide 1-bit establishing image for the
 * current location, under the header. Generated on a scene change to an
 * uncached location; a placeholder shows while it renders. Tap ⟳ to regenerate.
 */
export function Banner() {
  const location = useStore((s) => s.game.location);
  const key = bannerKey(location);
  const url = useStore((s) => s.images[key]);
  const pending = useStore((s) => s.imgPending[key]);
  const editFailed = useStore((s) => s.imgError[key]);
  const regenerate = useStore((s) => s.regenerateBanner);
  const edit = useStore((s) => s.editBanner);
  const [zoom, setZoom] = useState(false);

  return (
    <div className="relative aspect-[16/5] shrink-0 overflow-hidden border-2 border-ink mx-3 mt-1">
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
        <div className="flex h-full w-full items-center justify-center px-3 text-center uppercase tracking-widest opacity-50">
          {pending ? "rendering banner…" : location}
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
      {editFailed && !pending && (
        <span className="absolute bottom-1 right-1 border-2 border-ink bg-paper px-1 text-[0.6rem] uppercase tracking-widest">
          edit failed
        </span>
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
