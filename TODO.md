# TODO

- This is a list of open and completed tasks added by the user.
- Newest tasks are at the bottom.
- When you complete a task, check the checkbox, and describe what you did to solve the task.

## TASKS
---
[x] Player Character should be saved in a snapshot. Restoring a snapshot would then also restore the saved Player Character.

Solved together with the task below, since both need the same move: the cast
(PC included) now lives in `GameState.characters` instead of a global library
outside every save, so a `SaveSlot` — which is a `GameState` — carries it by
construction. `restoreSlot` restores the game's own cast wholesale rather than
merging into whatever is in the app; the Saves list shows the PC's name on each
slot, and the restore confirmation says the cast is replaced. A slot taken
before the move carries no cast (`loadGame` → `legacyCast`) and keeps the one in
hand, so old snapshots still restore.

---
[x] Let's make Characters also not global but Snapshot -specific. A new adventure essentially has an empty character list by default, but when the user clicks "Start a new adventure", show a modal with checkboxes to decide what to import over to the new adventure, if anything. Options: Scenario & Opening Message, Player Character, Characters, World Notes.

- `GameState.characters: Character[]` — the cast is part of the adventure. The
  store's separate `characters` slice is gone; `game.characters` is the single
  source of truth, and `commitCharacters` writes + autosaves it like any other
  slice. An equip move is now ONE write (both halves live in the same document),
  and a turn's narrator-created companions ride into `nextGame` with everything
  else it touched.
- Migration: `defaults.ts → loadGame` (was `splitLegacyGame`) reads all three
  cast eras and flags `legacyCast` for a document written while the library was
  global. Hydrate folds the old `__characters__` store in once
  (`db.ts → loadLegacyCharacters` — never written again, never deleted);
  `withPC` guarantees there is always a player character.
- Cloud sync lost the `characters` document and its `merge` policy — the cast is
  covered by the active game's one conflict prompt, which is the only correct
  answer once it is per-adventure (a set union would have quietly refilled a new
  adventure's empty cast from the other device). The retired key is *skipped*,
  not tombstoned (`sync.ts → LEGACY_CHARACTERS_DOC`), so a device still on the
  older build keeps its cast.
- New Adventure: `NewAdventureModal` asks what to carry over — **Scenario &
  Opening · Player Character · Characters · World Notes**, four independent
  checkboxes (first two ticked by default), each row showing what it holds
  ("3 characters", "12 world notes"). The rules live in the pure, tested
  `defaults.ts → seedAdventure`: the party always starts empty, `npc` standings
  ride along only with the cast, and beats / journal / quests / inventory always
  reset.

---
[x] Research: Add a cheap model layer (default: gpt-oss 120b) that'll help determine if the narrator should write a new NPC, item, add items, take items, etc.

Built as a post-turn verifier (`src/lib/verifyOps.ts`), the sibling of the
existing block-repair side call: it runs AFTER `deltas.ts → reconcileBlock`
(which already folds out restatements/no-ops for free) and BEFORE
`applyDeltas`, so it only has to judge ops that already survived that
deterministic filter. `pendingVerification` picks out the two shapes worth
asking about — a party `add` naming nobody in the cast (a genuinely NEW
character, companion or NPC alike) and every inventory `add` (an already-
deduped claimed pickup) — and skips the call entirely on the ordinary turn
with neither. When there's something to ask, a cheap model checks each claim
against the beat's own prose and returns per-claim verdicts; unsupported ones
are dropped from the block before it applies, records, or gets chipped by
`toasts.ts`.
- `Settings.cheapModelId` (default `openai/gpt-oss-120b`) is a new,
  deliberately separate model field — Narrator → Model → **Verification
  Model** — since the check is short and structured, not narration, and
  blank falls back to the Text Model. `openrouter.ts → completeChat` gained
  an optional `model` override to make this possible without touching any
  other side call.
- Gated by a new `Settings.features.opVerification` flag (Narrator →
  Features → Play), on by default like every other feature — off skips the
  call entirely and every op applies exactly as it did before this existed.
- **Fails open everywhere**: no candidates → no call; a missing key, timeout,
  aborted turn (Stop), or an unparseable reply all mean nothing is vetoed.
  The gate can only subtract a proposed op, never add one, so a broken
  verifier is never worse than no verifier — same discipline as every other
  side call in the app (`generateField`/`autoUpdate`/`repairBlock`).
- Pure core is unit-tested (`verifyOps.test.ts`): candidate extraction,
  tolerant reply parsing (fail-open per-entry on a missing/malformed verdict,
  not just per-call), and the block-filtering apply step.

---
[ ] Items, character names, etc. should be bolded and coloured (e.g. yellow or red by default), like in Zelda games. When characters talk (text in quotes), that too should be a different colour. These colours should be adjustable in Appearance settings.

---
[ ] Research: I want the engine to keep better track of the world and locations. Spawn point (start point) is coordinate 0,0,0 and moving will update the coordinates in that direction. Whenever moving to a new location, a description of that location is generated, and cached. The cheap model layer could determine roughly the distanced traveled, e.g. if I write "I travel to X", that might add more than 1 to the coordinates. If I ever come back to the same location, the cached description is used. For example, but not necessarily this exactly. Whatever gets the job done.

---