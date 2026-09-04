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
[x] Items, character names, etc. should be bolded and coloured (e.g. yellow or red by default), like in Zelda games. When characters talk (text in quotes), that too should be a different colour. These colours should be adjustable in Appearance settings.

New pure module `src/lib/highlight.ts` (colocated `highlight.test.ts`, 22
cases) splits narrator prose into plain / entity / quote /
`entity-in-quote` runs and renders alongside the existing
`segmentDialogue` → `parseInline` pipeline in `ChatView.tsx` — highlighting
runs first on the raw text, and only the leftover plain runs still get
`**bold**`-style markdown treatment.
- `collectEntityNames` gathers every character's `nameForms` (every
  standing, not just active party) plus pack `inventory` and per-character
  `equipment` labels, deduped by `slug`; matched word-boundary-anchored
  (`worldNotes.ts`'s `(?<!\w)...(?!\w)` pattern) and longest-first so
  "Rusty Key" wins over a bare "Key".
- Precedence: a quoted clause stays ONE colour throughout (no flicker
  mid-sentence), but an entity name mentioned inside it still bolds — color
  is quote > entity, weight is entity > quote. Verified end-to-end in a
  live browser (Playwright): `'"Give me the Rusty Key," Hiro demanded.'`
  renders "Rusty Key" bold+dialogue-coloured (inside the quote) and "Hiro"
  bold+highlight-coloured (outside it).
- Two new `Settings` fields, `highlightColor`/`dialogueColor`
  (`normalizeHex`-sanitized, zero migration), two new `ColorRow`s in
  `AppearanceScreen.tsx` beside the existing paper/ink pickers, and two new
  CSS custom properties (`--highlight`/`--dialogue`) written onto `<html>`
  by `App.tsx` the same way `--paper`/`--ink` already are — confirmed live
  in-browser that changing Dialogue in Appearance repaints the open beat
  immediately.
- `theme.css`'s "two colors only" header comment now notes these two as a
  deliberate, player-requested exception layered on top of the ink/paper
  base, not a retraction of it for the rest of the app's chrome.

---
[x] Research: I want the engine to keep better track of the world and locations. Spawn point (start point) is coordinate 0,0,0 and moving will update the coordinates in that direction. Whenever moving to a new location, a description of that location is generated, and cached. The cheap model layer could determine roughly the distanced traveled, e.g. if I write "I travel to X", that might add more than 1 to the coordinates. If I ever come back to the same location, the cached description is used. For example, but not necessarily this exactly. Whatever gets the job done.

The "generate a description once, cache it, reuse on revisit" half was already
built (`places.ts`'s `Place`/`ensurePlace`/`fillPlace` lifecycle) — the actual
gap was coordinates, closed by new module `src/lib/travel.ts`.

- `Place.coords: {x,y,z}` (`types.ts`), assigned in two phases, mirroring how
  a place's own sheet is authored: the instant a new place is stubbed,
  `store.ts` gives it a position for free — a deterministic guess seeded off
  `(turn, action text)` (`travel.ts → fallbackCoords`, reusing `stakes.ts`'s
  `seedHash`/exported `avalanche`, the same key `rollDice` seeds on so it
  reproduces exactly on regenerate) — then a cheap-model call
  (`Settings.cheapModelId`, `travel.ts → estimateTravel`, `verifyOps.ts`'s
  shape) reads the arrival prose and may refine it into a direction (one of
  six — north/south/east/west/up/down, a closed ladder, no diagonals, for
  reliable cheap-model classification) and a distance label (`step` ·
  `short` · `moderate` · `long` · `epic`, `clock.ts → DurationLabel`'s
  template: the model only ever names a label, the client owns the numbers).
  The very first place an adventure ever creates gets exact `{0,0,0}`, never
  computed. Once set, a place's coordinates are frozen exactly like the rest
  of its sheet — `fillPlace` preserves the stub's coords through its own
  async sheet-fill rather than letting the authored reply's placeholder
  overwrite them.
- New flag `Settings.features.trackCoords` (Features → Play → "Track World
  Coordinates"), separate from `places` and off with no LOOM channel of its
  own — coordinates are never something the narrator sees or writes, so
  there is nothing for `filterBlock` to strip.
- Migration is sanitize-at-read (`places.ts → normalizeCoords`), same
  posture as `normalizeDuration`/`normalizeDice`: a place stored before this
  existed defaults to the origin on next load, no batch script. `same()`
  (the reference-stability check behind `normalizePlaces`) now compares
  coords too, so a legacy row missing them is correctly seen as changed and
  backfilled rather than passed through coords-less.
- Backend tracking only, by design — no map. Position shows as plain
  `(x, y, z)` on each place's entry in the Places screen (`ReadBlock`,
  read-only for now).
- Follow-up: the scene mark in scrollback (`ChatView.tsx → SceneMark`) that
  used to read `LOCATION · Day N` now reads `LOCATION (x, y, z)` — day is
  dropped from it entirely. First cut paired the coordinate with the AREA's
  single point, which read as broken in play: walking down a road inside the
  same town (a `location` change with no new `Place`) showed the identical
  number every time, because nothing below the area level had a point of its
  own.
- Follow-up #2: coordinates are now tracked per ROOM, not just per area —
  `Place.locations: {name, coords}[]` (`types.ts`), a cache of every distinct
  `location` string visited inside that place, each frozen the same
  two-phase way `Place.coords` already was (deterministic guess, then a
  cheap-model refine from the beat's own prose). `Place.coords` keeps its
  old meaning — the entry room's point — and stays in sync with that room's
  entry in `locations`; every OTHER room in the same area gets its own point
  computed relative to wherever the player just stood
  (`places.ts → currentPoint`/`findLocationPoint`/`withLocationPoint`), so
  crossing between two known rooms without discovering a new area still
  moves the number, and returning to a room already visited reuses its
  cached point rather than rolling a new one. `store.ts`'s discovery block
  now fires on any `location` change, not only a new `Place`; `Message.area`
  (added for the first cut) still stamps each beat so the scene mark can
  resolve the right area's cache. Migration is the same sanitize-at-read
  posture as everything else here — a place stored before this existed reads
  `locations: []` — and `same()` compares the list too, for the identical
  reference-stability reason it already had to for `coords`.

---
[ ] UI restructuring:
- TOP BAR changes:
  - Remove player avatar, and hearts
  - Remove MENU button (moved to Nav Bar)
  - Make the top bar 50% thinner vertically
  - Show: "PLAYER NAME | DAY # | TURN # (how many turns have passed since start) | (WEATHER) (the current weather)"

- Introduce a BOTTOM NAV BAR, which contains buttons for:
  - PARTY (Rectangle, label)
  - INVENTORY (Rectangle, label)
  - QUESTS (Rectangle, label)
  - JOURNAL (Rectangle, label)
  - SAVE (Rectangle, label)
  - MENU (Square, icon)
 
- MENU changes:
  - Remove Party, Inventory, Quests and Journal buttons
  - Rename "This Adventure" into "World Lore"
  - Order of buttons:
    - Scenario
    - World Notes
    - Characters
    - Places

- NARRATOR menu changes:
  - Voice & Actions split into two: CORE INSTRUCTIONS and SUGGESTED ACTIONS
  - WRITING CHARACTERS renamed to CHARACTER INSTRUCTIONS
  - SUGGESTED ACTIONS: Remove AI SUGGESTED ACTIONS toggle from here, it's now in FEATURES
  - MEMORY: Remove JOURNAL toggle, it's now in FEATURES
  - New order:
    - FEATURES
    - MODEL
    - CORE INSTRUCTIONS
    - CHARACTER INSTRUCTIONS
    - SUGGESTED ACTIONS
    - MEMORY

- IMAGES menu changes:
  - Remove IMAGE GENERATION toggle from here, it's now in FEATURES
  - Set OFF by default

- RPG SYSTEM menu changes:
  - Remove STAKES toggle from here, it's now in FEATURES

---