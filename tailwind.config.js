/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Tailwind emits its `.invert` filter utility (`filter: invert(100%)`) as
  // soon as the bare word shows up in scanned source, and it once did — the
  // dark-mode setting was called `invert`, and the generated class flipped the
  // whole page (image bitmaps included) on top of the token swap it was meant
  // to be. That setting is gone, replaced by the `paper`/`ink` colors, but
  // nothing here has ever wanted a pixel inverter. Never generate it.
  blocklist: ["invert", "!invert"],
  theme: {
    // 1-bit: two colors only, plus two deliberate exceptions. Everything maps
    // to --ink / --paper tokens (see src/theme.css) so the whole app stays
    // one system; `highlight`/`dialogue` are the Zelda-style prose highlight
    // colors (lib/highlight.ts, Appearance → Colors), layered on top.
    colors: {
      ink: "var(--ink)",
      paper: "var(--paper)",
      // Ink at 60% — the dice toss's backdrop, and the one place the app is
      // deliberately between its two colors: the game has to stay legible
      // underneath it. Defined as its own token per theme (theme.css) rather
      // than an opacity utility, so it flips with everything else.
      scrim: "var(--scrim)",
      highlight: "var(--highlight)",
      dialogue: "var(--dialogue)",
      // Material-redesign destructive accent (Undo turn, Delete). See the
      // "Material-redesign layer" comment in theme.css for why this one
      // token is a real color rather than an ink/paper mix.
      danger: "var(--m-danger)",
      transparent: "transparent",
      current: "currentColor",
    },
    borderRadius: {
      none: "0",
      // Material-redesign pills/chips/switches/avatars (`rounded-full`) —
      // every other radius in that redesign is a literal `rounded-[Npx]`
      // arbitrary value, which needs no scale entry, but `full` is a NAMED
      // key and silently generates nothing without it. `none` stays the
      // only OTHER key so every untouched 1-bit screen keeps its square
      // corners — this is additive, not a return of Tailwind's full scale.
      full: "9999px",
    },
    extend: {
      fontFamily: {
        mono: "var(--font-mono)",
        // Material redesign's own face (theme.css) — additive, doesn't touch
        // `mono`, which the 1-bit screens (and Appearance's font picker) own.
        alata: "var(--font-alata)",
      },
    },
  },
  plugins: [],
};
