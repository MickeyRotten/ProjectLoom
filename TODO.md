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
