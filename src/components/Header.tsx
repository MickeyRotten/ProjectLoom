import { useMemo, useRef } from "react";
import { useStore } from "../store";
import { playerCharacter } from "../lib/roster";
import { coverKey } from "../lib/images";

/**
 * The Play-screen banner (Material redesign — DESIGN.md, `Loom Material
 * Redesign.dc.html`). Cover art for the adventure fills the top of the
 * screen; a gradient scrim fades it into the reading area below and carries
 * the status line (who's playing · day · turn · weather) plus the Menu gear,
 * both previously a flat bar of their own.
 *
 * Cover art is upload-only (a small pencil, top-right) — unlike a party
 * portrait there is no prompt template for "what this scene looks like", so
 * this deliberately doesn't grow a generation flow the design hand-off never
 * specced. No cover set yet still renders the banner (a flat tinted panel)
 * so the status line and gear have a place to sit from the first launch.
 */
export function Header() {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);
  const day = useStore((s) => s.game.day);
  const turnNumber = useStore((s) => s.game.turnNumber);
  const weather = useStore((s) => s.game.weather);
  const setScreen = useStore((s) => s.setScreen);
  const streaming = useStore((s) => s.streaming);

  const coverUrl = useStore((s) => s.images[coverKey()]);
  const coverPending = useStore((s) => s.imgPending[coverKey()]);
  const uploadCover = useStore((s) => s.uploadCover);
  const coverFile = useRef<HTMLInputElement>(null);

  // The mock-up's paper-on-photo chrome only reads once there's a photo —
  // with no cover set yet the banner is just the flat panel, and the status
  // line/gear need to fall back to ordinary ink-on-paper to stay legible.
  const chrome = coverUrl ? "text-paper" : "text-ink";

  return (
    <div className="relative isolate h-[190px] shrink-0 overflow-hidden bg-[var(--m-surface)]">
      {coverUrl && (
        <>
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 z-0 h-full w-full object-cover"
            style={{ objectPosition: "center 18%" }}
          />
          {/* Fades the art into the reading area's own background rather
              than a fixed dark tone, so it works over a light OR dark paper
              (Appearance lets the player pick either). Explicit z-index (and
              on every layer below) rather than relying on default paint
              order — a static <img> is supposed to paint under positioned
              siblings regardless of DOM order, but that's exactly the layer
              that went missing on-device, so nothing here is left implicit. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              background:
                "linear-gradient(180deg, transparent 35%, color-mix(in srgb, var(--paper) 75%, transparent) 82%, var(--paper) 100%)",
            }}
          />
        </>
      )}

      <input
        ref={coverFile}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadCover(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label={coverUrl ? "Change cover image" : "Add cover image"}
        disabled={coverPending}
        onClick={() => coverFile.current?.click()}
        className={`absolute right-1.5 top-1.5 z-20 flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40 ${chrome}`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19 3 20l1-4z" />
        </svg>
      </button>

      <div className="absolute inset-x-4 bottom-2.5 z-20 flex items-center justify-between gap-2">
        <span
          className={`min-w-0 truncate text-[11px] uppercase tracking-[0.14em] ${
            coverUrl ? "text-[color-mix(in_srgb,var(--paper)_90%,transparent)]" : "text-[var(--m-text-70)]"
          }`}
        >
          {pc?.name ?? "—"} &middot; Day {day} &middot; Turn {turnNumber}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {weather && (
            <span
              className={`text-[11px] uppercase tracking-[0.14em] ${
                coverUrl ? "text-[color-mix(in_srgb,var(--paper)_55%,transparent)]" : "text-[var(--m-text-40)]"
              }`}
            >
              {weather}
            </span>
          )}
          <button
            type="button"
            aria-label="Menu"
            disabled={streaming}
            onClick={() => setScreen("menu")}
            className={`flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40 ${chrome}`}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 2.5h3.4l.5 2.4a7.6 7.6 0 0 1 1.9 1.1l2.3-.8 1.7 3-1.8 1.6a7.6 7.6 0 0 1 0 2.2l1.8 1.6-1.7 3-2.3-.8a7.6 7.6 0 0 1-1.9 1.1l-.5 2.4h-3.4l-.5-2.4a7.6 7.6 0 0 1-1.9-1.1l-2.3.8-1.7-3 1.8-1.6a7.6 7.6 0 0 1 0-2.2L2.9 8.2l1.7-3 2.3.8a7.6 7.6 0 0 1 1.9-1.1z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
