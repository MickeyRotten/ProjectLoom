# Project Loom

LLM-driven, single-player, mobile-first (APK) text adventure in a stark **1-bit**
visual style. Client-only React + Capacitor; talks to OpenRouter directly.

Architecture and scope live in [`DESIGN.md`](./DESIGN.md) — the source of truth.

## Stack

React + TypeScript + Vite · Tailwind (1-bit token set) · Zustand · IndexedDB
(`idb`) · Capacitor → Android APK. No backend — the phone calls OpenRouter
directly; all logic + saves are on-device.

## Dev

```bash
npm install        # deps
npm run dev        # Vite dev server
npm run dev:pc     # dev server + phone frame (see below)
npm test           # vitest
npm run tsc        # typecheck (no emit)
npm run build      # tsc -b && vite build → dist/
npm run lint       # eslint
```

### Testing on a PC

Loom is mobile-first, so a full-width desktop browser is a poor preview.
`npm run dev:pc` opens [`frame.html`](./frame.html) — the app hosted in a
phone-sized iframe, with device presets, rotate, and downscaling for short
windows. On Windows, double-click [`launch_pc.bat`](./launch_pc.bat) instead:
it installs deps if they are missing (or half-extracted), starts the dev
server, and opens the browser.

It is an iframe rather than a CSS box because the app measures the *viewport*:
`100dvh`, the dice scatter's `vw`/`vh`, and every `fixed inset-0` overlay. A
nested browsing context gives all of them real phone dimensions, so nothing
under `src/` needs a dev-only branch.

`frame.html` is dev-server-only — Vite builds `index.html` and nothing else, so
it never reaches `dist/`, `cap sync`, or the APK.

## Android (Capacitor)

The native `android/` project is generated, not committed:

```bash
npm run build            # produce dist/
npm run cap:add:android  # one-time: scaffold android/
npm run cap:sync         # copy web build into the native project
```

CI ([`.github/workflows/android.yml`](.github/workflows/android.yml)) builds a
debug APK on every push and a signed release APK on `v*` tags (when signing
secrets are set).

## Status

**Phase 0 — Scaffold** complete. See DESIGN.md → Build Phases for what lands next.
