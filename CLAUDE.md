# Project Loom

LLM-driven, single-player, mobile-first (APK) text adventure in a stark **1-bit**
visual style. Client-only React + Capacitor; talks to OpenRouter directly (text +
image). Full architecture and scope live in [`DESIGN.md`](./DESIGN.md) — treat it as
the source of truth.

## Communication style — caveman mode (enforced)

This project enforces the vendored **caveman** skill
([`.claude/skills/caveman/`](.claude/skills/caveman/SKILL.md)). Respond in **caveman
mode, `full` intensity, by default, every turn**: terse "caveman speak" that keeps all
technical substance, code, commands, API names, and exact error strings verbatim, and
drops articles, filler, hedging, and pleasantries. Read
[`.claude/skills/caveman/SKILL.md`](.claude/skills/caveman/SKILL.md) for the full ruleset.

- **Persist** across the whole session — do not drift back to verbose prose. Off only
  on explicit `stop caveman` / `normal mode`.
- **Auto-clarity — drop to normal prose** for: security warnings, irreversible-action
  confirmations, and multi-step sequences where terseness risks a misread. Resume after.
- Switch intensity with `/caveman lite|full|ultra`.
- Never announce or name the style; no "Caveman:" recaps.

## Commits & reviews

- **Commit messages** — use **caveman-commit**
  ([`.claude/skills/caveman-commit/`](.claude/skills/caveman-commit/SKILL.md)):
  Conventional Commits, terse, why-over-what. (This repo's sessions may still append
  required `Co-Authored-By` / session trailers — those are trailers, allowed.)
- **PR / diff reviews** — use **caveman-review**
  ([`.claude/skills/caveman-review/`](.claude/skills/caveman-review/SKILL.md)): one
  line per finding — location, problem, fix.

## Project skills

Invoke these when touching the matching area (they guard the drift-prone core):

- **loom-turn-protocol** ([`.claude/skills/loom-turn-protocol/`](.claude/skills/loom-turn-protocol/SKILL.md))
  — the `<<<LOOM>>>` single-call turn contract: emit shape, stream-truncate-at-`<<<`,
  tolerant parse, delta apply + reversal. Read before editing the turn loop or
  response parser.
- **loom-spotlight** ([`.claude/skills/loom-spotlight/`](.claude/skills/loom-spotlight/SKILL.md))
  — deterministic party-spotlight signals, the `Name: "…"` dialogue convention, and
  `lastSpokeTurn` detection. Read before editing `spotlight.ts` or the spotlight block.

## Dev environment

A **SessionStart hook** ([`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh))
installs deps and prints the test/build commands each session. No-ops until the Phase 0
scaffold (`package.json`) exists.

## Attribution

caveman* skills under `.claude/skills/` are vendored from
https://github.com/JuliusBrussee/caveman (MIT). See
[`.claude/skills/ATTRIBUTION.md`](.claude/skills/ATTRIBUTION.md). The `loom-*` skills are
project-original.
