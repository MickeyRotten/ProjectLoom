/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The dark-mode setting is called `invert`, so the bare word appears in
  // scanned source and Tailwind happily emits its `.invert` filter utility
  // (`filter: invert(100%)`). Nothing here wants a pixel inverter, and one
  // stray `className="invert"` would flip the whole page — including image
  // bitmaps — instead of swapping the ink/paper tokens. Never generate it.
  blocklist: ["invert", "!invert"],
  theme: {
    // 1-bit: two colors only. Everything maps to --ink / --paper tokens
    // (see src/theme.css) so the whole app stays one system.
    colors: {
      ink: "var(--ink)",
      paper: "var(--paper)",
      transparent: "transparent",
      current: "currentColor",
    },
    borderRadius: {
      none: "0",
    },
    extend: {
      fontFamily: {
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
