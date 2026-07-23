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

  return (
    <div className="relative h-[10.5rem] shrink-0 border-b-2 border-ink">
      {url ? (
        <img
          src={url}
          alt={location}
          className="h-full w-full object-cover [image-rendering:pixelated]"
        />
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
    </div>
  );
}
