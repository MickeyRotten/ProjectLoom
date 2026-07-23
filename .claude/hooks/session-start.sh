#!/usr/bin/env bash
# Project Loom — SessionStart hook.
# Make the app testable in every (web) session: install deps and surface the
# test/build commands. No-ops cleanly until the Phase 0 scaffold exists.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

if [ -f package.json ]; then
  echo "[loom] installing deps…"
  npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1 || {
    echo "[loom] dep install failed — run 'npm install' manually." >&2
    exit 0
  }
  echo "[loom] deps ready. test: 'npm test' (vitest) · build: 'npm run build' · typecheck: 'npm run tsc'"
else
  echo "[loom] no package.json yet — scaffold not created. See DESIGN.md → Phase 0 (Scaffold)."
fi
