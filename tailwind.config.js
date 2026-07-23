/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
