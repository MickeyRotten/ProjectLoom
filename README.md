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
npm test           # vitest
npm run tsc        # typecheck (no emit)
npm run build      # tsc -b && vite build → dist/
npm run lint       # eslint
```

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
