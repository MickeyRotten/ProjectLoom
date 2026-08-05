# Project Loom — Core Design

## Context

Loom is a new, standalone project: an LLM-driven text adventure for **one player**,
**mobile-first (APK)**, in a stark **1-bit black-and-white** visual style. It's a
leaner spiritual successor to Wayward — it keeps the two ideas that make Wayward's
narrative scene good (the **Spotlight system** and a clean, isolated
**prompt-assembly** step) and deliberately drops the heavy machinery Wayward accreted
(agentic tool loop, Chronicler, Edit Mode, lorebook categories, campaigns/adventures
DB split, TTS, weather/backdrop system, Python backend).

Design goals, in priority order: **simplicity**, fast/short/punchy shonen-style
action, **sandbox** freedom, and **everything player-editable** without a separate
edit mode. It generates its own characters/items/quests/adventures and, as the story
moves, generates **black-and-white character portraits** via an image model.

### Locked decisions (from design Q&A)
- **Client-only, no backend.** One app; the phone calls OpenRouter directly; all logic + saves are on-device.
- **One pre-made scenario**, fully editable in Settings. Inline editing everywhere — no Edit mode.
- **Images via OpenRouter** (Nano Banana 2 Lite). Scope: **party portraits**, generated on demand, player can **regenerate**.
- **Uncensored adult** default.
- Carry over: **Spotlight**, **day counter**. Single-category lorebook = **World Notes**. Equipment = simple `{label, description, quantity?}` text fields per character, **moved** in and out of the shared inventory (see *Equip ⇄ Inventory*).
- **Turn model: single structured call** (not an agentic tool loop).
- **Action buttons: fixed + AI-generated** contextual options.
- **Multiple save slots**, no export/import.

---

## Tech Stack

| Layer | Choice | Note |
|---|---|---|
| App | **React + TypeScript + Vite** | same idioms as Wayward's client |
| Styling | **Tailwind** + a tiny 1-bit token set | pure `--ink`/`--paper`, monospace |
| State | **Zustand** | mirrors Wayward |
| Persistence | **IndexedDB** (via `idb`) | saves + generated image blobs (too big for localStorage) |
| Cloud saves | **Supabase** (Postgres + Storage), opt-in | named snapshots + settings, so a save restores on another device |
| AI | **OpenRouter** (OpenAI-compatible), text + image | direct `fetch`, no SDK |
| Packaging | **Capacitor** → Android APK | wraps the built web app; no embedded server |

No Python, no SQLAlchemy, no Chaquopy. The whole Wayward server layer disappears —
its logic (prompt build, spotlight) is ported to TypeScript.

---

## The Turn Model — single structured call

One player action = **one OpenRouter chat completion** (streamed). No on-device tool
loop. The model returns **narration prose followed by one machine-read JSON block**:

```
<narration prose here — short, punchy>

<<<LOOM>>>
{
  "location": "The Dusty Path",
  "weather": "windy",
  "day": 37,
  "options": ["Approach the ruins", "Signal the party to hold", "Scan the treeline"],
  "party": [ { "op":"add", "name":"Riley", "species":"human", "description":"...", "personality":"...", "drive":"...", "strengths":"...", "flaws":"...", "equipment":[{"label":"...","description":"..."}] } ],
  "inventory": [ { "op":"add", "label":"Cracked Compass", "description":"...", "quantity":1 } ],
  "quests": [ { "op":"add", "label":"Reach the Old Settlement", "description":"...", "reward":"..." } ],
  "spoke": ["Navi"]
}
<<<END>>>
```

- **Streaming display truncates at `<<<`** so the JSON never flashes (Wayward's `StreamingWindow` does exactly this — port that trick).
- Client **parses tolerantly** (brace-matched salvage, always strip the block from displayed prose even if JSON is malformed — port `parse_action_block`'s tolerance from `narrator_actions.py`).
- `options` are the **AI-generated action buttons** — inline in the same call, so no extra request per turn (Wayward's `inline` action-suggestions mode).
- State changes (`location`/`day`/`weather`/`party`/`inventory`/`quests`) are applied to the active save (op-based add/update/remove; inventory carries `quantity`, quests carry `reward`). `spoke` is a hint, but **`lastSpokeTurn` is updated deterministically** from the prose via the ported `detectSpeakers` (never trust the model alone).
- **`location` is ONE place name, the most specific one.** The protocol says so ("Damp Cellar", never "Boars Head Tavern - Damp Cellar"), and `deltas.ts → simplifyLocation` enforces it on the way in: a compound joined by ` - `, ` — `, ` / `, ` > `, ` | ` or `: ` keeps only the **last** segment, since with those joiners the tail is the narrower place. Prompt wording alone wasn't enough — the location is the scene label the reading area rules off with, so "Tavern - Damp Cellar" and "Damp Cellar" read as two different rooms every time the model changes its mind about the prefix. Commas are deliberately **not** joiners ("Rodstroke, Mesmeria" nests the other way round), and a hyphen without surrounding spaces is part of a name ("Half-Moon Inn"). A location that is nothing but separators leaves the scene unchanged.
- `party` ops match **by name across the whole cast**, so a companion from an earlier adventure is re-used, not duplicated. **A sheet is authored once, at creation, and frozen after**: only an `add` naming someone genuinely new writes `species`/`description`/`personality`/`drive`/`strengths`/`flaws` **and their starting `equipment`** (straight onto the new `Character`) — the narrator kits a companion out from the appearance it just wrote, and the gear is the player's from then on. Every later op — `add` or `update` — carries `standing` and nothing else; sheet fields on a character who already exists are dropped. An `add`/`update` may carry `"standing": "active" | "benched" | "npc"`, and a `remove` `"standing": "departed" | "fallen"` — nothing the model emits ever deletes anyone. See *Characters ⟂ Party*.
- **A character can be renamed** (`names.ts`, `PartyDelta.newName`). Matching by name is what makes the whole party channel work — the narrator only ever knows a character as a string — and it is also what made a rename impossible. Asked to add "a character who enters the player's story", a narrator adds one the moment a goblin swings a club, before anybody in the scene has a name for it; two beats later the goblin gives a name and the model's only way to connect the two is a second `add`, so the party holds **Unnamed Goblin** *and* **Grik**. Renaming in place was no better: the id, the roster entry and the `portrait:<id>` cache all survive, but the transcript, the journal and the model's own next few ops keep saying the OLD name, and every name-keyed path — `detectSpeakers`, the spotlight's `directlyAddressed`, NPC keyword gating, Auto-Update's story scan — silently stops matching until the history window rolls over. So a rename is one operation with two halves: **the name moves and the old one is kept.** `Character.aliases` is the list of names someone has answered to (newest first, capped), `names.ts → nameForms` is what every matcher takes instead of `c.name`, and `withRename` is the only writer — shared by the narrator's `{ "op":"update", "name":"Unnamed Goblin", "newName":"Grik" }` and by the player editing Name on the member sheet, so the two cannot mean different things. The sheet stays frozen through it (a rename is not a way back in), a `newName` on the op that *creates* somebody renames nobody, and a rename onto a name that already belongs to someone **else** is refused — that op is the narrator conflating two characters, and merging two sheets, two portraits and two standings is the player's call. The prevention rides beside the cure, as `Settings.namingInstructions` (Narrator → *Names & Renames*): don't add a character until the player has something to call them — a name, an alias, or the title they are known by; someone nameless is prose. That is only prevention, though, and never enough on its own — an alias revealed as a real name is the same event, and no naming discipline stops it.
- **An op that changes nothing is not an op** (`deltas.ts → reconcileBlock`) — every channel, folded before anything applies or records it. A narrator asked every turn *what changed* answers with the state instead: it re-reports an acquisition it already made, re-states a mark someone already carries, re-sends the Gold total it can see in INVENTORY. Most of that is harmless to the state (setting X to what X already is costs nothing) but **inventory `add` merges quantity**, so a restated `add` is `+1` a turn and the pack fills with Rusty Key ×7 — and none of it is harmless to the transcript, since `toasts.ts` derives its chips from the recorded block. A chip is a claim that something happened: "Hiro: Armed with a strange, glowing sword" on four beats in a row, "Gold: 15" on a beat where nobody paid anybody. So a row is dropped when the state it asks for is the state already there — a condition equal to the current mark, an `update` to the count it already is, a quest `add` for a quest already on the board, a party op leaving someone where they stand, a `remove` for something not held, an op naming a character or item nothing resolves. Plus the two the data shape creates: an **exact-duplicate row inside one block** is written once (keys sorted, so field order can't hide a copy), and an inventory **`add` with NO `quantity` for an item already held** is a restatement — dropped, or demoted to the `update` it meant if it brought a new `description`. An `add` *with* a quantity is always honoured ("picked up 2 more torches" is a real event). State is tracked *as the block runs*, so a pickup earlier in the same block counts, and Gold stays held through a `remove` (the purse empties, the row survives). The store applies **and records** the folded block.
- **Gold has to be earned in the prose** (`deltas.ts → goldIsNarrated`). Gold is the field a narrator restates and then quietly improvises: shown "Gold ×15" every turn and asked what changed, it starts answering with a number — 15, then 25, then 45 — across beats about mushrooms and satchels where not a coin is mentioned. A restated total is caught as a no-op; an **invented** one is a real change, and the only evidence it never happened is the narration. So a Gold row that MOVES the total is dropped unless the beat contains a money word (`MONEY_WORDS` — the nouns of coin and the verbs of paying, matched on word boundaries so "golden wheat" and "coincidence" are not money). Deliberately generous, because the costs are asymmetric: a missed word silently withholds money the player earned. The check is Gold-only and prose-only — every other item is judged on state alone, and a caller passing no prose makes no claim about the beat. Nothing comparable guards *seeing* vs *taking*: the discriminating signal is a verb, and the log that motivated this had "the sword slides free" (a real pickup, no acquisition verb) next to "inside lies a crystal" (not a pickup) — a verb gate would have dropped the real one. That half is prompt-side.
- **The prompt carries the matching rules**, so the fold is a backstop rather than the only defence: an inventory `add` means the player TOOK it in the prose just written (an object seen in a chest, held by someone else, or waiting at the end of an offered option gets no op — *if "Take the X" is one of your options, X is not in the inventory*); a Gold op only on a turn where money changes hands, never restating the total; a condition only to set, change, or clear a mark, never to re-send one; and, over all of it, *every op is a change your prose just made — an op that sets something to what it already is will be discarded.*
- **Reversal** (swipe/regenerate): record the applied deltas on the message, unwind on redo — same shape as Wayward's `_reverse_message_effects`, minus item instances.
- **Stakes** (`Settings.stakesEnabled`, on by default): before the call, `stakes.ts` decides on-device whether the action is a gamble and, if so, hands the narrator an outcome band it must honour. See *Stakes* below.

---

## Stakes — `src/lib/stakes.ts`

The sibling of the spotlight, and built the same way: **deterministic signals
computed on-device, one prompt block, no extra LLM call, and the model never
gets to pick the answer.** Without it every action succeeded exactly as much as
the narrator felt like, and `Character.flaws` had no mechanical consumer
anywhere — it was printed into the prompt and read by nothing.

**Every number below is a setting** (Menu → **RPG System**). `DEFAULT_DICE` /
`DEFAULT_STAKE_RULES` are the 1d6 system `stakes.ts` used to hardcode, so an
unconfigured game — and every call that omits its rules — plays exactly as it
always did.

- **Risk gate.** `isRisky` word-boundary-matches the risk words (via
  `worldNotes.ts → keywordHits`, so "mentioned" means one thing across lore,
  cast, and risk). Deliberately about *attempts*, not violence — a haggle and a
  lie are gambles, "I look around" is not. A non-risky turn injects **no block
  at all**: no tokens, no melodrama, and the three quick actions never roll. The
  list is `Settings.riskKeywords` (comma/newline text, `parseKeywords`, shipped
  as `RISK_KEYWORDS`); `Settings.alwaysRoll` skips the gate entirely for a table
  where every turn is a check.
- **The roll.** `rollDice(turn, action, rules)` hashes FNV-1a over
  `turn|action` **once**, runs it through a murmur3 finalizer (`avalanche`), and
  takes `% diceSides + 1`; dice 2..n count off that same mixed base
  (`avalanche(base + i × 0x9e3779b9)`). **Pure in (turn, action text, rules)**:
  `regenerateLastTurn` re-sends the same input on the same turn, so a random roll
  would let the player re-roll until the answer was "strong"; seeding means a
  regenerate re-*tells* the same result, and editing the action — genuinely
  choosing something else — earns a new roll.

  Both mixing steps are there because the obvious version rolled **unfairly**,
  and both are covered by regression tests:
  - Feeding a raw FNV hash to `% diceSides` leaks its low bit — FNV's bit 0 is
    just the XOR of the input bytes' low bits, and `h % sides` shares its parity
    for even `sides`. A die's parity was therefore a predictable function of the
    seed's characters, and on a seed family where the turn's digits also appear
    in the action text they cancelled outright: a d6 that could only roll 1, 3
    or 5.
  - Hashing `turn|action|i` per die — seeds a suffix apart — leaked the same
    relationship *between* dice and locked them into opposite parities: **2d6
    could never roll 7**, only even sums. Each die looked perfectly uniform on
    its own, which is how it survived; only the joint distribution was wrong.

  The cost is that a roll is no longer the number the pre-`DiceRules` build
  produced for the same (turn, action). Nothing recomputes a past roll except
  `regenerateLastTurn` — saved beats display their recorded `TurnRoll` — and a
  fair die is worth more than replaying an unfair one.
- **The modifier.** `+strengthsBonus` when the action's keywords meet the
  actor's Strengths, `−flawsPenalty` when they meet their Flaws, using the same
  `extractKeywords`/`intersects` pair as the spotlight's `strengthsRelevant`, so
  relevance can never mean two different things. Both apply at once — on the
  shipped ±1 that cancels to 0 (doing something you are good at in a way that
  plays to your weakness is an even-odds moment); a table that weights them
  differently gets whichever way it leans. A 0 bonus turns Strengths off
  mechanically without touching the sheet.
- **The bands.** `total ≥ strongThreshold` STRONG · `≥ mixedThreshold` MIXED ·
  below COST (shipped: 5+ / 3–4 / 2−). The block is marked *authoritative* for
  the same reason the roll call is: read as advice, the model narrates a triumph
  over a "cost". The roll, its reason **and the scale** are stated in full
  ("Rolled 1d6 2 -1 (flaws in play) = 1 → COST." / "Scale: 5+ strong · 3–4 mixed
  · 2− cost.") — the mechanic is visible, not a hidden hand, and a 3 that needed
  a 4 is a different beat from a 3 that needed a 12.
- **`normalizeDice` sanitizes on every read**, never on write: dice are clamped
  to 1–10 × d2–d100, modifiers to 0–20, thresholds inside the range the dice can
  actually reach (an unreachable STRONG makes every gamble a disaster, which
  reads as a bug rather than a house rule), and MIXED can never sit above STRONG.
  Clamping at *read* time is what lets the screen edit one field without
  quietly rewriting the one below it mid-keystroke.
- **`Settings.stakesRule`** (RPG System → Results) is the editable half: what
  STRONG / MIXED / COST *mean* in this world. The shipped rule ends by
  forbidding PC death — a narrator handed a bare "COST" eventually kills the
  player and strands the save.
- **Conditions** (`RosterEntry.condition`, `LoomBlock.conditions`) are where a
  COST lands: free text, per-adventure, matched by name across the **whole**
  cast **including the PC** — unlike `PartyDelta`, because the player is who a
  costly outcome marks most often. Its own op-less channel on purpose: party ops
  carry the frozen-sheet rules, and a condition is the one piece of character
  state the story is *supposed* to keep rewriting. Blank clears it, and
  `setCondition` deletes the key rather than storing `""` so a cleared mark and
  an unmarked character are the same stored shape (`captureReversal`
  reference-diffs the roster). Reversal needs no new slice — conditions live in
  the roster it already snapshots.
- **Visible in play:** the band **and the arithmetic behind it** are recorded on
  the narrator `Message` (`outcome` + `TurnRoll`, written by `rollRecord` — which
  also stores the dice it was rolled on, so a transcript still reads correctly
  under a system the player has since re-tuned) and render as one inverted chip
  above that beat's state-change toasts — *"Strong result · 1d6 4 +1 = 5"*, or
  *"2d6 [4, 3] 7 +1 = 8"* on multiple dice, with the modifier's reason and the
  band scale on the chip's title. The verdict alone read as the app editorialising about the beat;
  the numbers show it was a die, and show Strengths/Flaws doing something. The
  wording of the reason lives once, in `modifierNote`, shared by the prompt block
  and the chip, and the flags are stored rather than the prose so old saves can't
  pin old phrasing. Turns recorded before the roll was kept still show their band
  alone. The mark itself is an always-editable field on the member sheet (outside
  the Edit gate and outside the member-only block, since the PC has one too).
- **The toss** (`lib/diceAnim.ts` + `components/DiceOverlay.tsx`,
  `Settings.diceAnimation`, on by default): a rolled turn throws the dice across
  a full-screen **60% ink scrim** — real CSS 3D cubes, tumbling, landing on the
  faces the turn actually rolled — holds the result on a solid plate, and fades
  out. They land on a **tilted surface** (`SCENE_TILT` is the shipped angle;
  `Settings.dicePitch`/`diceYaw`/`dicePerspective` are the player's, read through
  `sceneView` — one rotation on the scene, not per die): dice resting on a common table are parallel to each
  other and it is the table that sits at an angle to the viewer. Square to the
  camera a landed cube is just a bordered square; at an angle its top and side
  show and the perspective does real work. Bounded well inside 45°, or the
  neighbouring face would out-face the one that was rolled.

  The throw itself is one animation in three segments (`loom-die-toss`, with
  `PHASE` naming the keyframe stops `TIMING` is checked against): **up from off
  the bottom-left**, the way a hand throws them, out to a **scattered spot**
  inside `SAFE_AREA` — placed by rejection sampling against `MIN_SPACING`, since
  a plain random draw clumps and overlapping cubes are unreadable — a beat lying
  there so the throw reads as a throw, then **collected into a centred row**
  (`gridSpots`, wrapping to a grid past `GRID_COLUMNS`, short last row centred on
  its own width) above the result plate. The dice are absolutely positioned and
  moved by transform alone: a flex row would keep asserting a position the
  animation is trying to leave. The scrim (`--scrim`, its own per-theme token, so it flips with
  ink/paper) is the one tone in the app that is neither ink nor paper: the beat
  the player just sent stays legible underneath, so the dice land *in* the scene
  rather than on a screen the game cut away to — which is also why the result
  panel gets an opaque backing, since prose showing through the arithmetic is
  the one thing the scrim costs. Staged in `sendTurn`
  **before** the model is called, so the ~2.4s plays over the wait for the first
  token rather than adding to the turn; tap anywhere to skip. No 3D library: six
  `preserve-3d` faces and two keyframes, with **no lighting or shading** (a lit
  die needs greys the 1-bit tokens don't have — depth reads from the silhouette
  and the turning faces alone). Pips on a d6, the numeral on anything else. The
  choreography is *pure in the `TurnRoll`* (`planToss`, seeded through the same
  `seedHash` as the roll itself), so a regenerated turn re-throws the same arc —
  nothing new happened, and nothing should look like it did. Presentational only:
  the numbers exist before the animation does, and the beat's chip shows the same
  result whether it ran, was skipped, or is switched off. `prefers-reduced-motion`
  skips straight to the landed result.

---

## Ported from Wayward (TypeScript)

### 1. Spotlight — `src/lib/spotlight.ts` (near-verbatim port of `server/ai/spotlight.py`)
The single most valuable carry-over. Port faithfully:
- `STOPWORDS`, `GROUP_ADDRESS_RE`, `_SAID_VERBS`, `_name_pattern`, `_member_spoke`.
- `computeSpotlightSignals(playerMsg, recentContext, party, currentTurn)` → `{directlyAddressed, strengthsRelevant, turnsSinceLastSpoke}`.
- `formatSpotlightBlock(signals, rule)` → the `PARTY SPOTLIGHT — THIS TURN` block.
- `detectSpeakers(responseText, party)` → ids that actually got a line, to bump `lastSpokeTurn`.
- Keep the rule text (`DEFAULT_SPOTLIGHT_RULE`) editable in Settings.
- **Same dialogue convention** (`Name: "…"`) drives both the client display segmenter and speaker detection — one convention, wired once.

### 2. Prompt assembly — `src/lib/prompt.ts` (trimmed port of `prompt_builder.py::build_prompt`)
One isolated function returning the OpenRouter `messages[]`. It is built in **tiers**, running from the oldest and most general material to the newest and most specific, so nothing the model reads is contradicted by something it read earlier.

**Two rules hold the shape together**, and both are easy to break by adding "one more block":
- **Every fact is stated once.** A mark is in `CONDITIONS`, not also on the sheet; a sheet is in the standing context, not also in the roll call. A model shown the same fact twice re-states it, and a re-statement costs an op, a toast chip and a line of transcript.
- **Anything the history can contradict is stated *after* the history.** That is the whole reason the state tier exists.

**Tier 1 — standing context** (one `system` message; the slow-changing half, and first so it stays a stable prefix between turns):
1. **Core narrator instructions** (Loom role: short punchy second-person shonen adventure, uncensored, sandbox) + player **custom instructions**. The one block with no header — it is not a block of data.
2. **Scenario / premise** (the editable pre-made scenario), via `formatScenarioBlock`, which the side calls share.
3. **PC sheet** + equipment.
4. **Party roster** — the `active` members only. Benched members get no sheet; they are not in the scene.
   Every character block — PC, party roster, NPC sheet — leads with the same identity line, `Name (species, sex)`, from `roster.ts → formatIdentity`, and prints the same sheet lines in the same order from `roster.ts → formatTraits` (Personality · Drive · Strengths · Flaws · Notes; blanks drop out). Both are shared so three views of one sheet cannot drift; `formatTraits` deliberately excludes `condition`, which is per-adventure state and belongs to tier 4.

**Tier 2 — turn context** (one `system` message, skipped entirely when nothing matched): the keyword-gated material *this* action pulled in. Four derivations of one scan text — the new message plus the last `CONTEXT_TURNS` beats — so they travel together. All four gate through `worldNotes.ts → keywordHits` and share **one** window constant, because "mentioned" has to mean the same thing in all four.
- **World Notes** (single-category, simplified `match_entries`; titles are implicit keywords). Notes flagged **permanent** skip matching and inject every turn.
- **Known characters** (`cast.ts`) — the sheets of `npc`-standing allies the scene just named, capped at `NPC_LIMIT`. Gated, not always-on: an adventure can know fifty people without any of them costing a turn they're absent from.
- **Spotlight block** (`spotlight.ts`) — over the `active` members only.
- **Relevant gear** — equipped items of the PC + `active` members whose keywords surface in the action.

**Tier 3 — history**: the rolling window (trim to a token budget; prepend the opening narration as the first assistant turn — port `_trim_to_budget`).

**Tier 3b — journal** (`formatJournalBlock`): what already happened, newest first, under its own budget. Placed *after* the history and *before* the state because it is the older material: the window holds the last few beats verbatim, and this is the stretch behind them the window has already dropped. Not keyword-gated (a journal is chronological, not topical); bounded by construction instead, with entries past `JOURNAL_PROSE_ENTRIES` decaying to their client-derived facts before dropping out.

**Tier 4 — state of play** (one `system` message, always emitted): what is true *right now*. Everything here is re-read from `GameState` each turn, and everything here is something the history actively misremembers — a companion who has since left, a purse already spent, a room already walked out of. They sit under **one** authority line; three blocks each claiming to override the beats read as three arguments, and the model picks one.
- **Current scene** — location · day · **phase** · weather. Time reaches the model as a phase word only, never a clock face (`clock.ts → phaseOf`).
- **Active-party roll call** (`formatPartyComposition`) — the composition, re-read from the roster **every turn**. Names the `active` members `n/PARTY_LIMIT`, the `benched` ones under an explicit "NOT in this scene", the most recent departures with their `standing` (`partedMembers`) so the narrator stops writing them in — and never resurrects a `fallen` one — and every `npc` by name, so an ally is never forgotten between the turns that reach them. **Always emitted, even for an empty party** ("the player is ALONE") — the empty case is exactly where the history drifts.
- **Conditions** (`stakes.ts → formatConditionsBlock`) — the marks this adventure has left on the PC + `active` members, and the only place a mark is printed or explained.
- **Inventory** (compact `label ×qty — description` list) — here rather than in tier 1 because the output protocol's inventory rules point straight at it ("use the label already in INVENTORY, exactly as written"), and up top the rule and the list it names were a whole history window apart.
- **Active quests** (compact `label — description (reward: …)` list; done quests omitted).

**Tier 5 — this turn, then the ask** (each its own `system` message):
- **Outcome band** (`formatStakesBlock`), when the action was a gamble and stakes are on — a fact about *this* action, kept out of the state block because the history is full of turns that went differently.
- **Regeneration note** (`formatRegenerateNote`), when ↻ Regen carried one — direction to the narrator rather than something true in the world, and never folded into the player's message (which is also the stakes seed).
- **Output-protocol instruction** — how to emit prose + the `<<<LOOM>>>` block, and the `option` instruction (player-editable). Directly before the action, so the shape is the last thing read.
- **Player's new message.**

---

## Image Generation — `src/lib/images.ts`

- **Access:** OpenRouter chat-completions with an image-output model (Nano Banana 2 Lite), reading the returned image (base64 data URL) from the response. *(Exact request/response shape for image output over OpenRouter must be verified against current OpenRouter docs at implementation time — flag, don't assume.)*
- **Two backends, one seam (`Settings.imageBackend`, Images → Model):** `generateImage` is the only function in the app that turns a prompt into pixels, so a second backend is a dispatch inside it and nothing else changes — the store pass, the IndexedDB cache, the placeholder and the failure badge never learn which machine drew the picture. **OpenRouter** is the default and is untouched. **ComfyUI** (`src/lib/comfyui.ts`) points the same deterministic trigger at a server the player runs themselves: free to render, their own checkpoints, and no network round-trip to a vendor. See **ComfyUI** below.
- **One kind, deterministic trigger (not model-driven):**
  - **Party portrait** — keyed by `portrait:<memberId>`. When a member has no portrait, generate from their name/species/**sex**/description + the **portrait style instructions** — *unless* the player removed it (`Character.noPortrait`), see **Remove** below. Sex is in the Subject because an image model given only prose guesses, and guesses differently on every regenerate.
- **Style baked in:** the default portrait instructions enforce **monochrome black-and-white line art** — the app's look is asked for in the prompt, not imposed on the pixels afterwards (see *No post-processing* below). Player-editable under Images → Prompt Templates, as one of several **templates**, see below.
- **Master switch (Images → Image Generation, `Settings.imagesEnabled`, ON by default):** one setting that stops *every* request to the image model — automatic portraits and ⟳ alike. A player who didn't want to buy pictures otherwise had to press *Remove Image* on every character, one at a time, forever, because the automatic trigger redraws whatever isn't cached. The gate is on **generation only** — `imagesAllowed` in `images.ts`, folded into the `cacheOnly` flag, so `syncImages` degrades to a cache probe and everything already drawn still shows. Uploads, downloads and *Remove Image* all keep working (none of them talks to a model); ⟳ hides, forced portraits no-op, and the Image API Key + Image Model fields hide under the switch that made them dead. Nothing stored is deleted. Ships **on** because portraits have always drawn themselves — shipping it off would read as a broken pipeline, not a saving.
- **Regenerate:** ⟳ on each member sheet re-runs generation and **replaces the cached blob** — generated or uploaded, whatever is there loses. A forced regeneration that fails flags `imgError` (an *image failed* badge) **with the reason** — "failed" alone is unactionable, and the causes are wildly different (no credit, a refused prompt, an unreadable file). ⟳ also clears `noPortrait`.
- **No post-processing, and no editing (removed).** The app used to quantize every picture to true 1-bit on-device — downscale to 192px, Bayer/threshold dither (`onebit.ts`), display it `image-rendering: pixelated` — and keep the pixels it was crushed from as a **master** under `src:<key>`, because the master was the only copy worth handing back to a model. ✎ did that: instruction + the master → the result *became* the new image. Both are gone. There is **one blob per key**, it is what the model drew (or the file the player supplied), and nothing in the app sends a stored picture back to a model. What survives is the bound: `toStoredImage` decodes, caps the longest side at `MAX_IMAGE_SIDE` (1024) and re-encodes as JPEG **only if it had to resize** — a 12-megapixel camera JPEG per character is what IndexedDB cannot hold, a 1024px portrait is not. The style is asked for in the prompt instead of enforced on the pixels, which is also why the `DitherMode` setting, its three-button *1-Bit Shading* row and the `PORTRAIT_PIXEL_WIDTH`/`UPLOAD_PLAIN_WIDTH`/`EXPORT_MIN_WIDTH` widths are all deleted rather than defaulted off. **Migration:** on first launch `db.ts → promoteLegacyMasters` moves every `src:<key>` blob onto `<key>` and drops the prefix, so an upgrading device keeps *the masters* — the good pixels — and throws away the thumbnails. It is awaited before `syncImages`, since publishing first would leave the promotion sitting behind an object URL of the copy it replaced; a character with no master keeps the small copy it has (one ⟳ redraws it).
- **Remove (member sheet):** *Remove Image* deletes a member's portrait, revokes the object URL, and sets `Character.noPortrait` on the global character. The flag is the whole point: the automatic trigger is "no cached portrait → draw one", so without it the next turn's `syncImages` would silently undo the removal. It's a character-level choice (a portrait is shared across adventures), and only ⟳ or an upload clears it.
- **Upload / download (member sheet):** *Upload Image* replaces a member's portrait with a file from the device — through the same `toStoredImage` bound a generated portrait gets, so every picture in the store is one kind of thing; ⟳ still regenerates over it. Unlike the generated path, the upload pass is **strict**: a file the browser can't decode (HEIC straight off an iPhone, a renamed non-image) fails the upload loudly instead of being stored verbatim — storing it "succeeds" and then shows a portrait that never loads, with nothing on screen to say why. *Download Image* saves the stored blob out **as it is**: it is the full picture now, so there is nothing to undo on the way to the device (this is where the nearest-neighbor `toExportBlob` upscale used to be, and why it is gone). Delivery is `lib/download.ts`, three paths in order: on the **APK**, `@capacitor/filesystem` writes the bytes to the app cache and `@capacitor/share` opens the native save/share sheet — the Android System WebView implements neither `navigator.share` nor blob `<a download>`, so this is the only route that reaches the device; then browser **Web Share** with files; then an `<a download>` click on desktop. A dismissed sheet counts as done; any other failure surfaces as a note under the button.
- **Storage:** image blobs in IndexedDB, referenced by key; UI reads via object URLs. **One blob per key** — see *No post-processing* above. `LEGACY_MASTER_PREFIX` (`src:`) is still named in `images.ts`, read once by the migration and written by nothing.
- **Snapshot art (`slot:<slotId>:<key>`, `images.ts → slotScopedKey`/`slotArtPairs`):** a save slot snapshots the whole game — the cast and the PC included — but the pictures live *outside* the document, one blob per character for the whole app, so every ⟳, upload and *Remove Image* silently rewrote the faces of every save that character ever appeared in. Restore a save from ten turns ago and you got the old story wearing today's art. So **taking a snapshot copies the art too**, under keys of the slot's own (`slot:<slotId>:portrait:<cid>`), and the same character in two snapshots holds two different pictures. Copies rather than versioned live keys: everything that renders a portrait — the top bar, the party strip, the member sheet — keeps reading the bare `portrait:<id>` it always did, and a restore is a copy back. Restoring is **per character**: a slot with no frozen copy for someone (one taken before this existed, or a cloud slot whose blobs have not landed) leaves that character's live art exactly as it is. Restored blobs are republished immediately — `ensureImage` returns early when a key already has an object URL, so the restored picture would otherwise sit in IndexedDB behind the one it replaced. Overwrite sweeps the slot's keys before re-freezing (a character who has left the cast must not linger; the sweep still covers the retired `src:slot:…` prefix, for blobs an older build left), and deleting a save deletes its art, stamped, so the cloud copy goes too. *Purge Stored Images* deletes every blob there is, frozen copies included — a restored save simply redraws.
- **Purge (Images → Stored Images):** one button — *Purge Stored Images* — deleting **every** stored blob from IndexedDB and, when signed in, from Supabase Storage as well. The per-item control was never enough: *Remove Image* is one character at a time, so re-tuning a template or a checkpoint meant redrawing a cast one sheet at a time, and a long game's portrait cache (one image per character ever met) could only be reclaimed by clearing app data. The store deletes through `db.deleteImage`, which stamps each key, so an ordinary sync pass propagates the deletion. That is **not** enough on its own, though: a key that exists only in the cloud — drawn on the other phone and never pulled here — has no stamp and no local blob, so if any save still names it `planImages` would read it as an image this device is missing and download it straight back. So `syncEngine.purgeRemoteImages` lists the bucket and removes every object directly, best-effort per key (a failure leaves the object *and* its stamp, so the local deletion still propagates later). Deliberately leaves **no** `noPortrait` flag: this is a cache purge, not a per-character "no picture", so the deterministic trigger redraws the PC and the party on the next turn — the confirmation says so. Not hidden when generation is off, since purging is exactly what a player does having just switched it off.
- **Diagnostics:** a 200 that carries no image is soft-retried once, then fails with the model's **own text reply** quoted (`extractMessageText`) — a model answering in words is usually saying why ("I can't create images of real people", a policy line), and discarding it leaves the player with a bare badge and nothing to change.
- Fire-and-forget with a visible placeholder while generating; a failed image never blocks the turn.

### Prompt templates — `src/lib/imageTemplates.ts`

Everything that decides *how an image prompt is worded* is one named, switchable
bundle (`ImagePromptTemplate`), picked from a dropdown at the top of **Images →
Prompt Templates**. It exists because the two backends want different **languages**:
a chat image model is told what to draw in prose, while an SD-family checkpoint
behind ComfyUI reads a comma-separated Danbooru-style tag list — and writing
prose at one wastes most of a 77-token encoder window. Two templates ship,
*Descriptive (chat models)* and *Tags (SD / ComfyUI)*; **New** / **Duplicate** /
**Delete** make more, and the name is a live field rather than a rename dialog.

- **`format` is structure, not wording** (`prose | tags`), and it is the half no
  amount of rewriting could cover. `images.ts → joinPromptParts` joins prose
  parts as labelled paragraphs and tag parts as comma-separated fragments with
  their trailing punctuation stripped; in `tags` the `Location:` / `Appearance:`
  labels go, **and so does the character's name** — a diffusion model's text
  encoder cannot read it, and the tokens come out of a budget the appearance
  needs. Deliberately *not* inferred from `imageBackend`: a prose-friendly
  checkpoint running locally is a perfectly normal setup, and the two choices are
  the player's to combine.
- **What's in a template:** the four portrait clauses
  (Action / Location-context / Composition / Style), the reference instruction,
  the **negative prompt** (moved off `ComfySettings` — a negative list is dialect,
  not machine config, and one server runs both dialects), and
  **`appearanceInstructions`**.
- **`appearanceInstructions` is in the template on purpose.** It steers the
  *text* model, but `Character.description` becomes the portrait's Subject
  **verbatim**, so a portrait prompt cannot be tags while the sentence that
  writes its Subject asks for prose. It reaches the narrator through the output
  protocol and `generateField.ts` exactly as before — only its home moved. The
  cost is visible and is why this is a template the player picks rather than
  something the backend switch does behind their back: sheets are **frozen at
  creation**, so switching dialect mid-adventure leaves the existing cast with
  the appearance they were written with (the member sheet's ✦ and Auto-Update are
  the way to re-word one), and a tag-style appearance reads as tags on the sheet
  too.
- **What's outside:** `portraitRefImages` and every ComfyUI
  connection field. Behaviour and machine
  config — a template must survive changing checkpoints, and a checkpoint must
  survive changing dialects. Reference *images* stay global for the same reason:
  they are files, and the same three references are what "our art style" means
  whichever wording describes it.
- **Normalized at READ time** (`normalizeImageTemplates`), like `normalizeDice`
  and `normalizeComfy`. A missing field takes its own dialect's ship text; a
  **blank** one stays blank, because blanking is how a rule is removed. The list
  is never empty and `activeTemplate` never fails — a dangling `imageTemplateId`
  takes the first template — since there is no sane state in which an image
  cannot be prompted. **Migration:** a save written before templates existed has
  its flat `portrait*` / `appearanceInstructions` /
  `comfyNegativePrompt` folded onto the *prose* built-in, so an edited style
  clause survives verbatim and the tag dialect simply appears beside it.

### ComfyUI — `src/lib/comfyui.ts`

- **The protocol:** `POST /prompt` with `{ prompt: <graph>, client_id }` → a `prompt_id`; poll `GET /history/<prompt_id>` (which answers with a map *keyed by prompt id* — `{}` means pending) until the entry appears; pull `{filename, subfolder, type}` out of the first output node carrying `images[]` and fetch `GET /view?…` for the bytes. `POST /interrupt` on abort or timeout. Polling rather than the websocket: a socket adds a second failure mode and a `clientId` handshake for a progress bar nothing renders, while history is the authoritative record either way. Unlike SillyTavern's loop this one has a **deadline** (`COMFY_TIMEOUT_MS`) — a phone that walked out of wifi range would otherwise sit on "rendering…" for the rest of the session.
- **The workflow is the player's**, stored as raw ComfyUI **API-format** JSON (what *Save (API Format)* exports) with `%placeholder%` tokens, and substituted by a **string replace on the JSON text with the quotes included** — `replaceAll('"%steps%"', JSON.stringify(25))`. That one mechanism gets the types right for free: `JSON.stringify` supplies the quotes for a string and emits a bare number for a number, so `"steps": "%steps%"` becomes `"steps": 25` while a prompt full of quotes and newlines lands correctly escaped. It also means **a template must wrap every placeholder in quotes, even numeric ones**. Tokens are deliberately SillyTavern's set, spelling included (`prompt · negative_prompt · model · vae · sampler · scheduler · steps · scale · width · height · denoise · clip_skip · seed`), so a workflow written for one works in the other: `scale` is CFG (there is no `%cfg%`) and `clip_skip` goes out negative, as `CLIPSetLastLayer` counts it. Everything a workflow doesn't reference is simply ignored, which is how a LoRA stack or a Flux pipeline is supported without a setting for it.
- **Validated where it's edited.** `validateWorkflow` runs on the *substituted* text — the raw template isn't valid JSON for a hand-written unquoted number — and both the editor and every generation call it, so a bad paste fails on the screen that caused it rather than as a missing portrait forty turns later. A blank stored workflow falls back to the shipped one (the editor would otherwise have nothing to show); a *broken* one is kept, because it's the player's edit and the error is on screen.
- **Sizing:** `comfyWidth`/`comfyHeight` are the base, used verbatim when no ratio is asked for. A portrait passes the same `aspectRatio: "2:3"` the OpenRouter path sends and is reshaped to that ratio **at the same pixel area**, snapped to multiples of 64 — so switching backends doesn't quietly change how much work a portrait is.
- **Reaching it from the APK** is three separate blockers, and one answer. ComfyUI returns a hard **403** to any request carrying `Sec-Fetch-Site: cross-site` unless started with `--enable-cors-header`; the Capacitor WebView is served from `https://localhost`, so `http://192.168.x.x:8188` is **mixed content**; and Android blocks **cleartext** from targetSdk 28. Requests therefore go through **`CapacitorHttp` on native** and `fetch` on the web — a native request leaves from Java, where none of those three rules apply (the manifest's `usesCleartextTraffic` is patched in CI, since `android/` isn't committed). `server.androidScheme` is deliberately *not* changed: that moves the app's origin and would orphan every installed player's IndexedDB saves. On the web build there is no escape and `--enable-cors-header` is genuinely required, so a 403 is translated into that sentence rather than surfaced as a status — it is the one error every new user hits, and nothing inside the app can fix it. The web POST also sends **no `Content-Type`**, which keeps it a CORS simple request with no preflight; ComfyUI reads the body with `await request.json()` and doesn't check.
- **Discovery:** *Connect* pings `/system_stats` and then reads `/object_info/{KSampler,CheckpointLoaderSimple,UNETLoader,VAELoader}` to fill the checkpoint / sampler / scheduler / VAE pickers (a combo input's options are `input.required.<field>[0]`). Every lookup is optional — a build without `UNETLoader` is normal. This exists because a wrong host and a mistyped checkpoint name fail *identically*, as a portrait that never appears, and neither is visible anywhere else in the app.
- **What ComfyUI does not do:** **portrait style reference images** are not sent — feeding an image into a workflow means a *different graph* with a LoadImage node, which is the player's to write and not something the app can substitute into one; the Image Prompts screen says so while the backend is selected. (Image *editing* was the other one, and it is gone for every backend — see *No post-processing* above.) Uploads, downloads, *Remove Image* and the zoom view are unaffected — none of them talks to a model.

---

## Data Model (on-device, TypeScript)

One **active game state**, autosaved continuously; **named save slots** are full snapshots.

```ts
Settings {                    // global, edited in Settings
  openRouterKey, textModelId, imageModelId (default: nano-banana-2-lite), temperature
  imageKey, imagesEnabled                      // Images — the image master switch
  imageBackend: openrouter | comfyui           // Images → Model — which machine draws
  comfyUrl, comfyWorkflow,                     //   ComfySettings (lib/comfyui.ts → DEFAULT_COMFY)
    comfyModel, comfyVae, comfySampler, comfyScheduler,
    comfySteps, comfyScale (CFG), comfyWidth, comfyHeight,
    comfyDenoise, comfyClipSkip
  reasoningLevel: auto | off | minimal | low | medium | high            // Narrator → Model
  // Narrator (sub-menus: Model · Voice & Actions · Memory · Writing Characters):
  customInstructions, optionInstructions                                // Voice & Actions
  historyBudget, maxTokens, journalEnabled, journalBudget,              // Memory (maxTokens: Model)
    journalMaxTurns, journalMinTurns, journalInstructions
  characterCreationInstructions, characterUpdateInstructions,           // Writing Characters
    standingInstructions, departureInstructions, spotlightRule
  // Images (sub-menus: Model · Prompt Templates · Stored Images):
  imageTemplates: ImagePromptTemplate[], imageTemplateId,               // Prompt Templates
    portraitRefImages
}

ImagePromptTemplate {         // one image dialect — lib/imageTemplates.ts
  id, name, format: prose | tags
  portraitAction, portraitContext, portraitComposition, portraitStyle
  portraitRefInstruction, negativePrompt
  appearanceInstructions      // steers the NARRATOR — the Subject must match the dialect
  // RPG System (its own screen — mechanics, not prompt text):
  stakesEnabled, stakesRule, riskKeywords, alwaysRoll, diceAnimation,
  dicePitch, diceYaw, dicePerspective,                                  // how the toss is drawn
  diceCount, diceSides, strengthsBonus, flawsPenalty,                   // DiceRules
    strongThreshold, mixedThreshold
}

Character {                   // one authored sheet — lives in GameState.characters
  id, role, name, species, sex, description, personality, drive,
  strengths, flaws,                      // free text, one field each
                                         // sex is free text too — pronouns for the narrator,
                                         // a Subject line for the portrait prompt
  notes,                                 // THE PLAYER'S field — read by the narrator, written by nobody else
  equipment: { label, description, quantity? }[],  // simple text fields, no catalog
                                         // written once by the creating `add`, player's after that
                                         // quantity absent = 1; it exists so a stack keeps its
                                         // count when it MOVES in from the inventory
  useCustomPortraitPrompt?, customPortraitPrompt?
}

GameState {                   // the active adventure (autosaved) + what each save slot stores
  scenario: { title, premise, openingNarration, startDay }   // the editable pre-made scenario
  characters: Character[]     // THIS adventure's cast — the PC among them
  roster: RosterEntry[]       // per-adventure character state (SPARSE — absent = defaults)
  worldNotes: Note[]          // { id, title, keywords[], content }  — single-category lorebook
  inventory: Item[]           // { label, description, quantity }  — shared party inventory
  quests: Quest[]             // { id, label, description, reward, status }
  messages: Message[]         // { role, content, turn, appliedDeltas, day, minutes, location, weather }
  journal: JournalEntry[]     // { id, day, fromTurn, throughTurn, lines: { text, source }[] }
  turnNumber, day, minutes, location, weather   // `minutes` = time of day, client-owned (clock.ts)
}

RosterEntry {
  id,                                   // Character.id
  lastSpokeTurn,
  standing: 'none'      // known character, not part of this adventure
          | 'npc'       // important ally / contact — NOT a companion
          | 'active'    // travelling with the player, in the scene
          | 'benched'   // in the party, waiting elsewhere
          | 'departed'  // left the story
          | 'fallen',   // dead
  overrides?: { species?, sex?, description?, personality?, drive?, strengths?, flaws? }
}
```

### Characters ⟂ Party — `src/lib/roster.ts`

**Characters is the cast; Party is who's walking with you.** They're separate on
purpose, and `roster.ts` is the only place they join (`resolve(base, entry)` →
`PartyMember`; `activeMembers`, `partyMembers`, `presentMembers`, `setEntry`,
`mergeOverrides`). Everything downstream — prompt, spotlight, images, UI —
consumes resolved `PartyMember`s, never the raw halves.

- **One `standing` ladder, per adventure**, not two orthogonal flags. A
  character is `none` (this adventure hasn't involved them), an `npc` (an
  important ally / contact / rival the world knows, holding no party slot),
  `active` (travelling with you, in the scene), `benched` (one of yours,
  waiting elsewhere), or `departed` / `fallen`. The old `inParty` + `status`
  pair could spell states nothing rendered — an over-cap joiner landed
  `inParty: false, status: "active"` and appeared in no prompt block and no
  screen. `normalizeEntry` folds any stored shape onto the ladder, forever:
  reversal snapshots live inside saved messages, so the old pair keeps arriving.
- **Only the scene is capped.** `partyCount` / `partyFull` count `active`
  members, so `PARTY_LIMIT` (**4**) is the marching order; the **bench is
  unlimited** and holds the stable. A narrator `add` past the cap lands the
  character BENCHED — visible in the Party screen, named in the roll call. The
  cap is 4 rather than 3 because it used to be "the party strip minus the PC";
  the PC moved up into the top bar and handed that slot back.
- **Benched members are the party's, but not the scene's.** They get no sheet
  in the prompt (#4), no spotlight signals, no gear scan, and no `lastSpokeTurn`
  bump — a sheet is an invitation to write someone in. The roll call names them
  under an explicit "NOT in this scene".
- **NPCs are keyword-gated** (#7b, `cast.ts` reusing `worldNotes.ts`'s
  `keywordHits`): their sheet rides along only when the new message or the last
  few beats name them, capped at `NPC_LIMIT`. The roll call still lists every
  NPC by name every turn, so an adventure can know fifty people at the cost of
  one line. NPCs carry into a **New Adventure** alongside the cast they belong to
  — an ally is a fact about the setting, not about one run.
- **Kick ≠ leaving the story.** Kick sets `none`: out of the party, still in
  Characters with portrait and sheet, and the narrator is told nothing about it.
  `departed` / `fallen` are story outcomes the player or the narrator sets, and
  only those reach the "no longer travelling" line.

- **Characters belong to the adventure.** They live in `GameState.characters`,
  so a save slot snapshots the cast and the **player character** with everything
  else, and restoring one gives back the people the story was saved with. They
  were global once, outliving every New Adventure; that made a snapshot a
  half-restore — the same plot with somebody else's hero in it — and it is the
  one thing a save is for. `roster.ts` still joins the two halves the same way;
  what changed is only which document the sheets sit in. A roster entry naming a
  since-deleted character still degrades to a smaller party rather than breaking.
- **"New Adventure" asks what to bring** (`NewAdventureModal` →
  `defaults.ts → seedAdventure`, pure): **Scenario & Opening · Player Character ·
  Characters · World Notes**, four independent checkboxes, defaulting to the
  first two. Nothing survives implicitly, because nothing can: the cast is part
  of the adventure being thrown away, and a sequel in a world you wrote and a
  clean break are equally common. The party always starts empty; `npc` standings
  ride along only when the cast does, since an ally is a fact about the setting
  and the setting is what the cast carries. Beats, journal, quests and inventory
  always reset — those *are* the adventure.
- **The party cap is measured on resolved members, never raw entries.**
  `partyCount`/`partyFull` go through `activeMembers`, so an entry nothing can
  resolve — a save slot or an **undo** restoring a snapshot taken before the
  player deleted that character — can't hold a slot that shows nobody
  ("Party Full" over an empty seat). Undo also `pruneRoster`s the restored
  roster so the dead entry doesn't persist.
- **A character's sheet is written once, then frozen.** The narrator authors
  appearance/personality/drive/strengths/flaws — and their starting equipment — on the `add` that *creates* someone,
  and never again — later deltas move `standing` only. Sheet drift was the
  story quietly rewriting an authored cast a turn at a time; character change
  belongs in the narration, and a deliberate re-read is what the member sheet's
  **Auto-Update** is for.
- **`Character.notes` is the player's alone.** It rides in the prompt with the
  rest of the sheet — the PC block, the party roster and an NPC's keyword-gated
  sheet all print `Notes:` when it is non-empty — but nothing writes it back:
  `PartyDelta` has no `notes` key, `CharacterOverride` has none either (so
  neither a narrator delta nor Auto-Update can reach it), and the member sheet
  gives it no ✦ generate button. It is the one place on a sheet where the
  player can say what a character is and know that no model output, freeze
  rule, or re-read will edit it.
- **Player edits the base; only Auto-Update writes overrides.** A sheet edit the
  player saves writes the global character and retires the override on the
  fields they touched (editing adopts the story's change). Auto-Update writes
  adventure-local `overrides`, so a companion wounded in one save is fine in
  another. **Revert Story Changes** drops them.
- **Nothing the model emits destroys a character.** Narrator `remove` only
  moves them along the ladder, and `standing` records why (`departed` /
  `fallen`, player-editable). A `fallen` character is never re-recruited by the
  narrator — only the player can bring them back, which clears the flag.
  Deleting is a player-only act, from the member sheet.
- **One LIVE portrait per character**, keyed `portrait:<characterId>` and shared
  across adventures, generated from how they look *in the current adventure* —
  plus one frozen copy per save slot, so a snapshot restores the faces it was
  taken with (see *Image Generation → Snapshot art*).
- **No world/adventure split beyond this.** Editing anything in Settings/panels
  edits the active game (matches "edit everything, no Edit mode"); "Save"/"Load"
  snapshot/restore slots.
- **Strengths** and **Flaws** are one free-text field each (no label/name), edited as plain text areas on the member sheet.

### Equip ⇄ Inventory — `src/lib/equip.ts`

The two halves of "what you have" could not reach each other: `GameState.inventory` is the party's shared pack (per-adventure), `Character.equipment` is what one person wears or carries (riding the character's own sheet). Both were editable, neither could hand anything to the other, so giving the looted sword to the swordswoman meant deleting a row on one screen and retyping it on the other — and typing it in both places is exactly how an item ends up existing twice.

- **It is a MOVE, never a copy.** An item is in the pack or on a person, **never in both**. `equipItem` / `unequipItem` return *both* new arrays or `null`; the store writes both halves together (`moveGear`) — the pack lives on the game, the kit on the character, and half a move applied is a duplicated or a vanished item.
- **Whole rows move, count and all.** That is what `Equipment.quantity?` is for: twelve arrows are still twelve after they change hands, and the move is exactly reversible — an accidental equip is a one-tap fix, not an arithmetic exercise. Absent reads as **1**, so every record written before this (and every narrator-authored kit) is unchanged.
- **Merging by the same `slug` the deltas use** (exported from `deltas.ts`, so "match" can't mean two things): equipping 3 arrows onto a kit that holds 12 reads **×15**, not two rows called Arrow. The receiving side's own description wins; a blank one is filled from the sender.
- **Gold never leaves the purse.** The currency row is permanent and belongs to the party, so `canEquip` refuses it — along with a blank label and an empty row.
- **Targets are the PC and the company** — `active` **and** `benched`, since stowing gear on the one who stayed behind is half of what a bench is for. NPCs are not: their kit is the world's.
- **Where the buttons are:** **Equip** on each Inventory row (read mode only — an open draft is not yet the pack) opens a target picker; **Unequip** on each member-sheet Equipment row (also read mode, for the same reason Condition sits outside the Edit gate: it writes two stores at once, which a local draft can't hold).
- **The narrator sees the count** — `equipLine` is the single renderer for an equipped item (`Label ×3: description`), used by the PC block, the party roster and the Auto-Update sheet, so a count the player moved can't be visible on the sheet and invisible in the prompt. Equipment is still **frozen** for the model: no delta writes it after creation, and moving gear is a player act with no story stamp.

Note the asymmetry the split makes unavoidable: the pack is per-adventure, a character's kit is global. Gear equipped in one adventure travels with that character into the next one; the pack does not.

---

## UI — single column, mobile-first, 1-bit

Layout top-to-bottom (the reference screenshot is a **style guide, not literal truth**):

```
┌──────────────────────────────────────┐
│ [KAI] KAI                         =   │  header IS the PC: portrait · name ·
│       ♥♥♥♥♥♥                          │  hearts at the left, menu at the right
│──────────────────────────────────────│
│ [NAVI] [RILEY] [ELARA] [   ]          │  party portrait strip (tap → sheet)
│──────────────────────────────────────│
│  narration prose (short, scrolls)     │  message log
│  — THE DUSTY PATH · DAY 37 —          │  scene mark, where either changes
│  ...                                  │
│  1. Approach the ruins                │  AI options — in the chat view, under
│  2. Signal the party to hold          │  the latest beat (tap or number key)
│  3. Scan the treeline                 │
│ [ LOOK ] [ PARTY ] [ INVENTORY ]      │  fixed buttons
│ > _______________________________     │  freeform input
└──────────────────────────────────────┘
```

- **Top bar = the player character.** A small square portrait at the left, the
  name beside it, a row of **six hearts** under the name, and the menu button at
  the right edge. Tapping anywhere on the portrait/name block opens the PC's
  member sheet — which is the only route to it, since the PC is no longer in the
  party strip.
  It used to be the location bar (place · day · menu), and both of those facts
  are already in the reading area: `ChatView`'s **scene marks** rule off the log
  with "SOMEWHERE · DAY 3" every time either one changes. The bar was spending
  the most valuable strip of a phone screen restating a line the player had just
  read, while the PC — the one character always in the scene — had no permanent
  place on screen at all and was instead renting one of four party-strip slots.
  The **hearts are a placeholder**: six filled glyphs, drawn from nothing,
  holding the shape a future hit-point system would take. They are `aria-hidden`
  for exactly that reason — announcing "6 of 6 health" would describe a mechanic
  this app does not have.
- **AI options:** 3–4 contextual choices from the `<<<LOOM>>>` block, rendered **in the chat view, directly under the latest narration beat**; number keys submit; each just sends its text as a normal turn. They scroll with the chat, tethered to the beat that produced them.
- **Chat scrolling:** the log opens on the newest beat and follows the tail while the reader is parked there; scrolling up into the history stops the follow and shows a **↓ LATEST** button back to the live edge.
- **Party strip** sits **directly under the top bar, above the reading area**; always visible; tapping a portrait opens that member's **full-screen sheet** (info · edit fields · **regenerate portrait** · **auto-update**). Strip portraits are zoomed 50% and top-aligned so the face fills the slot; the sheet's portrait frame is **2:3**. It holds **companions only** — the PC is the top bar now, which put the whole cast together at the top of the screen (the strip used to hang below the log, a screen's height from the PC it was showing alongside) and left the reading area running uninterrupted from there to the composer. The freed slot went back to the cap, so `PARTY_LIMIT` and the strip's width are the same number again.
- **Quick actions (`Settings.quickActions`)** are the three buttons above the input, shipped as LOOK · WAIT · INVESTIGATE and **editable in place**: a ✎ beside them opens a modal with a **label** and an **action** per row (the label is what the button says; the action is what gets sent as the turn, word for word), plus *Reset to Defaults*. What counts as "the thing I do every other turn" is a property of the table, not of the app — a dungeon crawl wants LISTEN, a courtly game wants BOW. **Clearing both halves drops that button**, so a player can run two shortcuts or none; the row is fixed at three because a fourth either shrinks them below a comfortable tap or wraps. `settings.ts → normalizeQuickActions` folds anything stored (a short array, a row with no `input`, junk) onto exactly three well-formed rows at READ time — but never fills a **blank** row back in, since blank is how a button is deleted. ✎ is never disabled: editing a button is not a turn, so it works mid-stream and without a key.
- **Inventory view:** a list of `Label · Description · Quantity` rows, editable inline, each with an **Equip** button in read mode (see *Equip ⇄ Inventory*) and a **✦ generate** button beside Remove in Edit mode (see *Item generation*).
- **Quests view:** a list of `Label · Description · Reward` rows (+ active/done status), editable inline; reached from the menu/header (kept off the 3-button row to preserve the screenshot's layout).

### Character sheet auto-update — `src/lib/autoUpdate.ts`
The member sheet's **Auto-Update** button opens a modal to check which fields the model may rewrite, then runs **one non-streamed side call** (`completeChat`, tighter temperature than narration) that must answer with a single JSON object. Only three fields are ever writable:

- **Appearance** (`description`) — physical characteristics are **preserved verbatim**; only what the character wears/carries is rewritten, read off their **Equipment** labels + descriptions. Since `description` is the portrait Subject, the sheet's ⟳ picks up the new outfit.
- **Personality** / **Drive** — re-read from the latest `MENTION_SCAN_LIMIT` beats whose text **mentions the character by name** (word-boundary match, same machinery as World Notes).
- **Strengths**, **Flaws** and **Equipment** are never touched — the player owns them, and equipment is what Appearance reads *from*.

Parsing is tolerant like the `<<<LOOM>>>` block (fences/preamble/trailing commas survive) but strict about content: unrequested keys, non-strings, and blanks are dropped, so a bad reply narrows to "fewer fields updated" and never blanks a sheet. Gated behind read mode (an open edit draft would clobber the result) and blocked mid-turn.

### Per-field generation — `src/lib/generateField.ts`

Auto-Update's sibling, and the difference is **where it reads from**. Auto-Update re-reads a character off the **story so far**, so it is a story change. This is **authoring**: a ✦ button beside **Appearance · Personality · Drive · Strengths · Flaws** opens a modal that writes that one field from the character's own sheet — **Species and Sex above all** — the scenario, and the World Notes those words trigger (`worldNotes.ts → matchWorldNotes`, the same keyword matcher, scanned over the sheet instead of the beats). It never reads the beats: a character who hasn't appeared yet is exactly who this is for.

- **One field per call.** Only the requested field's rule is sent, so the model is never told about a field it must not write. Appearance's rule *is* the selected image template's `appearanceInstructions` — the same sentence the narrator gets — so "Appearance" means one thing app-wide.
- **Preview, then accept.** The modal shows what came back with **Use This / Generate Again / Cancel**, at a looser temperature than a sheet update (authoring wants variety; a re-roll should differ). An optional guidance box rides last in the prompt, so it outranks the sheet it may deliberately contradict.
- **✦ only in Edit mode.** An accepted generation lands in the sheet's **edit draft**, not the character — so **Discard Changes is the undo** and **Save Changes** is what commits it (through `updateCharacter`, which retires that field's story override). The generation reads the draft too, so a Flaws written right after the player typed a Personality reads that Personality.
- The store action writes nothing and takes the character **by value**; it needs no `streaming` guard for that reason, only single-flight.

### Scenario fields — `src/lib/generateScenario.ts`

The same ✦ one level up: **Premise** and **Opening Narration** on the Scenario screen each carry a generate button, running through the shared `GenerateModal` (guidance in, preview back, *Use This / Generate Again / Cancel*) and the same one-key JSON contract, parsed by `parseGeneratedField` — one tolerant parser rather than two that drift.

- **Context is the scenario, never the beats.** The title, the starting location, the *other* field, the player character, and the World Notes those words trigger. This is the text a **new** adventure starts from, so reading the one being played would be backwards. The field being written is not sent as context either — it is a draft to replace.
- **Premise** is asked for as the world (background the narrator re-reads every turn); **Opening Narration** as the first beat, second person, ending on the question — the same shape a turn is written in.
- **No Edit gate here.** The Scenario screen writes as you type, so an accepted generation commits immediately; the modal says so before it lands, rather than implying a Discard Changes that this screen does not have.
- Shares `fieldGenPending` / `fieldGenError` with the character generator — one generate modal is open at a time app-wide, which is the assumption the single-flight guards already make.

### Item generation — `src/lib/generateItem.ts`

The third ✦, and the only one that writes a **whole row**. The two places a player types gear by hand are the shared pack (**Inventory**) and one character's kit (the member sheet's **Equipment**), and both rows hold the same three values — so both carry the same button, beside **Remove**, in **Edit mode**: tap Edit → *+ Add Item* → ✦ → the shared `GenerateModal`.

- **Three keys, one call.** `label` · `description` · `quantity` come back together in one JSON object, with a parser of its own (`parseGeneratedItem`) rather than three `parseGeneratedField` calls: split across calls, a description could describe something the label never named. A **missing label is a failure** — a nameless item is nothing, so the row is left exactly as the player had it — while a missing description is only a blank field to type into. `normalizeItemQuantity` pins the count to 1…999 and floors fractions, so a model answering with a year or a price never becomes the number in the pack.
- **Two flavours, one builder.** `ItemRow` covers both shapes (`Item.quantity` is required, `Equipment.quantity` optional). With no character it writes for the **pack** and gets an `ALREADY IN THE PACK` block; with one it writes **equipment** and gets that character's `formatSheet` instead, its EQUIPMENT list rebuilt from the *draft* kit — two copies of the same gear read to a model as two sets of gear.
- **Authoring, never the beats** — the scenario, what is already carried, the character when there is one, and the World Notes those words touch. The row being written is left out of its own context: it is the draft being replaced, and listing it would forbid the very thing ✦ was pressed on.
- **Both screens are Edit-gated**, so an accepted item lands in the draft and **Discard Changes is the undo**. Gold gets neither ✦ nor Remove: the purse is permanent and its label is locked.
- Shares `fieldGenPending` / `fieldGenError` with the other two. `GenerateModal` is generic over its result for this one caller — a `preview` render prop; a plain-string caller passes none.

### Shell + reachability

- **Hardware / browser Back closes the overlay**, instead of quitting the app
  from any screen — nothing listened for either before. The mechanism is one
  spare history entry, kept alive for as long as any overlay is open: back pops
  it, the app closes one level, and re-pushes a spare if a screen is still
  open. At the play screen there is no spare, so back leaves — correctly.
  Screens with internal depth register `setBackHandler` on the store (the
  `SubMenuScreen` sub-menus) rather than taking an `onBack` prop, because a prop can never reach
  the hardware button. The popstate handler re-arms the spare **itself** — a
  handled back may not change `screen` at all, so an effect keyed on `screen`
  would miss it and the next back would exit.
- **Soft keyboard**: `#root` is `100dvh` (with `height: 100%` as the fallback)
  plus `interactive-widget=resizes-content`, so the keyboard shrinks the shell
  instead of pushing the composer off-screen.
- **Touch targets** are `min-h-11` (44px) on `btn`/`btnSmall`, the turn
  controls and the header gear. `btnSmall` — used for Restore
  / Delete / Remove / Reset, i.e. exactly the mis-taps worth avoiding — was
  ~26px. It still *looks* small; only the hit area grew.
- **Turn options are visible.** Regen / Edit / Undo were revealed only by an
  unhinted tap on a plain `<div>`, so they were invisible to a new player and
  unreachable by keyboard or screen reader. A `⋯ Turn options` button under the
  latest beat is the discoverable, focusable path; the tap still works.
- **One navigation model.** Party / Inventory / Quests / World Notes / **Saves**
  are in the gear menu as well as the ⋯ shortcut. Most of them used to live
  *only* behind ⋯, so the one thing that looks like navigation pointed at half
  the app; Saves had the opposite problem — it sat last in the gear menu, five
  taps from a player about to do something they might want to undo. Snapshotting
  is a mid-play act, so it is now in **both** lists, and grouped with play in the
  menu rather than filed under settings.
- **Regenerate takes a note.** ↻ Regen opens a box for one line of direction —
  "shorter", "let her refuse", "less combat" — before it re-runs the turn. A bare
  re-roll only ever gave the model another go at the identical prompt, so a beat
  that went wrong in a *specific* way could only be fixed by rolling until it
  happened not to. Blank is the default and is byte-for-byte the old behaviour
  (`prompt.ts → formatRegenerateNote` emits nothing). The note rides as its own
  system block **beside** the roll call and the outcome, never folded into the
  player's message: the message is the transcript, the history window, and — the
  load-bearing one — the **seed the stakes roll is drawn from**, so folding a
  note in would let a player re-roll a bad outcome by retyping their complaint.
  The block also tells the narrator the note is direction, not something the
  character said, so nobody in the scene reacts to "make it shorter".
- **`useConfirm`** replaces six native `confirm()` calls. On the Android WebView
  those render as system-styled alerts — rounded, platform-blue, another
  typeface — in the middle of a hand-built monochrome app, and they cannot be
  focus-managed or given a destructive-action label. The replacement restores
  focus to where it came from and closes on Escape.
- **`prefers-reduced-motion`** is honoured for the one pulsing cursor.

### First run — `SetupScreen`
A fresh install used to open on a running game that could not run: the quick
actions greyed out at `opacity-30` with no explanation, the freeform input
stayed enabled, and the only route to the key screen was to type something,
watch the turn fail, and read the error. Setup is now a gate — key, text model,
optional image model — shown while `Settings.setupDone` is false.

- **`setupDone` is its own flag, not "is there a key"** — gating on the key
  would throw the player out of setup on the first character they typed.
  `loadSettings` backfills it from the presence of a key, so an existing player
  is never handed a setup screen for a game they have been playing.
- **`verifyKey`** (`/api/v1/key`, authenticated) backs a **Test** button.
  Nothing else in the app can tell a good key from a typo: the model catalog is
  a *public* endpoint, so it loads happily with garbage in the field, and a
  wrong key otherwise stays invisible until the first turn fails.
- **`ModelPicker`** replaces the bare `<select>` over several hundred models
  with a filter box. `KeyField` / `ModelPicker` / `useModelCatalog` are shared
  with Narrator → Model and Images → Model so the three can't drift.
  - **The whole catalog, by default.** It used to render only the first 60 rows
    and ask the player to keep typing, which made an alphabetical accident look
    like a curated shortlist and hid most of the catalog behind a search that
    only helps if you already know the model's name. Every model for that
    modality is listed (`splitModels` still keeps image-output models out of the
    text field and vice versa); the filter narrows, and a count line says how
    much of the catalog is showing.
  - **Free-only checkbox.** `OpenRouterModel.free` is read from the catalog's own
    `pricing` — free when **neither** prompt nor completion bills — not from the
    `:free` id suffix, which is a naming convention some free models don't
    follow. Unreadable or missing pricing counts as priced: a model whose cost we
    can't read must never be advertised as free. Free models are also labelled
    in the list itself, and the current pick stays selectable even when the
    checkbox or the filter would exclude it.
- **Failed images say why.** `ensureImage` recorded `imgError` only on a forced
  ⟳, so an automatic portrait that failed left an eternal placeholder
  and no reason — the cause (no credit, refused prompt, unreadable file) only
  surfaced if the player happened to press ⟳. It now records on both paths.

### Secondary screens
All secondary screens — **member sheet, Party, Inventory, Quests, and every Settings sub-screen** — are **full-screen overlays with a Back button** in a top header (the mobile pattern; no split panes). They open over the chat and return to it on Back. Same store/components regardless.

- **Menu (gear)** → full-screen screens in **two captioned groups**, play-facing
  first. *This Adventure*: **Party**, **Inventory**, **Quests**, **World Notes**,
  **Journal**, **Saves**, **Characters** (the whole cast), the **Scenario**
  editor. *Settings*: **Narrator**, **Images**, **RPG System**, **Appearance**,
  **Cloud Saves**. Then, below a rule, **New Adventure**. Party / Inventory /
  Quests / World Notes / Saves are also on the ⋯ shortcut beside GO.

  The captions are the fix for a list that had grown to thirteen identical
  buttons holding two unlike kinds of thing with nothing to chunk them by. The
  split is the one already load-bearing in the data model — the first group lives
  in `GameState` and is replaced by the next New Adventure, the second lives in
  `Settings` and outlives every adventure — which is also why New Adventure sits
  under both rather than inside either. Captions rather than a nested *Settings*
  screen: the depth would cost a tap on every visit and buy nothing the caption
  doesn't.
- **Deep links, not paths in prose.** `setScreen(screen, section?)` carries an
  optional sub-menu, held as a one-shot `section` on the store and consumed by
  the arriving `SubMenuScreen`. Six copy strings used to *name* a path
  ("switched off under Menu → Model & Key", "counts against Advanced → Narrator →
  Beat Length Limit") and leave the player to walk it; they are `MenuLink`
  buttons now. `SUBMENU_INDEX` is the link that means "this screen's index",
  and an id matching no section resolves there too, so a stale link can never
  land on nothing.
- **Cloud Saves screen** is the account and nothing else: email + password, sign in / create account, last-sync line, **Sync Now**, **Sign Out**, and a closed **Supabase Project** section for a player running their own project (blank = the build's own, from `VITE_SUPABASE_*`). No checkboxes for *what* travels — a half-synced save is worse than none. The **Saves** screen is where the feature is actually used: a snapshot uploads when it is taken, and opening Saves pulls, so cloud saves simply appear in the list.
- **RPG System screen** owns the dice and nothing else: **Stakes** on/off, the
  dice (`diceCount` × `diceSides`), what Strengths and Flaws are worth, where the
  STRONG/MIXED bands sit, **when to roll** (`alwaysRoll`, or the editable risk-word
  list), the **dice toss** on/off with its **Test Roll** and view controls
  (**Table Pitch** / **Table Yaw** / **Perspective**, shown only when the toss
  is on — `sceneView` clamps the angles inside `MAX_TILT` on read, since past
  45° the neighbouring face would out-face the rolled one), and the **Outcome
  Rule** — with a live preview reading through
  `normalizeDice`, so what it shows is what will be rolled. Its own screen rather
  than a sub-menu of Narrator: Narrator is *prompt text handed to a model*, and
  this is mechanics the app resolves on-device before the model sees the turn.
- **Appearance screen** holds everything that changes how Loom *looks* and
  nothing that changes how it plays: **Text Size**, **Font**, **Colors**. All
  three started as closed lists — a four-step scale, three faces, and an Invert
  Colors toggle — and all three are now open.
  - **Font** (`Settings.font`) repoints the single `--font-mono` token through a
    `data-font` attribute on `<html>`, so no component knows about it. Three
    faces are **bundled** (`system` · `VT323` · `Jersey 15`; `src/fonts/`, SIL
    OFL) rather than linked from Google Fonts — the packaged APK plays offline,
    where a webfont over the network simply never arrives — and the two display
    faces carry a `size-adjust` so a Text Size setting means the same thing
    across them. Beyond those, the player **adds a Google Web Font by name**
    (`webFonts.ts`, `Settings.webFonts: WebFont[]`): Add fetches
    `fonts.googleapis.com/css2` — a 400 there *is* the spelling check —
    keeps the **latin + latin-ext** faces off the response's subset comments,
    downloads the woff2 files and stores them in a **`fonts` object store**
    (`db.ts`, DB v2), then injects the equivalent `@font-face` +
    `[data-font]` rules from blob URLs. Downloaded, not linked, so an added font
    behaves like a bundled one from the second launch onward. Each face's
    `unicode-range` is **persisted on the record**: re-mounted without them, two
    subsets both claim every character and a latin-ext file with no basic Latin
    in it blanks the app. **Remove** deletes the files; an unrecognised or
    removed selection falls back to `system` (`settings.ts → fontTheme`).
  - **Text Size** is **pixels** — `[−] 16 px [+]`, ±2 a press, 10–40 — not a
    four-step scale, because an added font carries no `size-adjust` and renders
    at whatever size its designer drew. Scope is unchanged: narration only.
  - **Colors** are two free values, `Settings.paper` and `Settings.ink`, set from
    a native swatch or a typed hex and sanitized on read (`normalizeHex`).
    `App.tsx` writes them onto `<html>` as the `--paper`/`--ink` tokens and
    **derives** the rest — `--scrim` (ink at 60%), `color-scheme` and the
    `theme-color` meta from the paper's relative luminance — so a color is
    decided in exactly one place. The old **Invert Colors** toggle is gone: it
    was one point in this space, and it is the first two of four presets (Ink on
    Paper · Paper on Ink · Amber CRT · Green CRT). Generated portrait art is a
    real 1-bit bitmap and stays black and white whatever is picked.
- **Narrator screen** is everything that steers the **text** model, as an
  **index of sub-menus** (`SubMenuScreen`): **Model** (OpenRouter API Key · Text
  Model · Reasoning · Temperature · Beat Length Limit), **Voice & Actions**
  (narrator instructions · AI suggested actions and their wording), **Memory**
  (`historyBudget` · the journal on/off with its budget, gap, floor and
  instructions), **Writing Characters** (creation · the freeze rule · standings ·
  departures · spotlight). Every prompt rule the story writes characters by is
  editable there, each with its own Reset; blanking one **drops that line** from
  the protocol rather than falling back to a built-in. The JSON *shape* around
  them is the parser's contract and is never editable.

  It is the text half of the retired *Model & Key* screen plus two of retired
  *Advanced*'s four sub-menus, and the join is the point: reasoning effort and
  the beat cap are billed against each other, and while they lived on different
  screens one of them had to explain the other in prose. Temperature likewise
  rejoins Text Model — it used to render *below* the entire image section.
  *Writing Characters*, not *Characters*, because the root menu already has a
  screen by that name holding the actual cast. `Memory — Turns Kept` became
  **Memory — Story**: it is a token budget, its own hint said so, and it now
  pairs with **Memory — Journal**.
- **Images screen** is everything that draws a picture, in one place — the three
  destinations this used to take (the master switch and backend under *Model &
  Key*, behaviour under *Advanced → Images*, wording under *Advanced → Image
  Prompts*) meant "why is there no picture?" had three possible answers and no
  route between them. Its **index** carries the one setting that applies to every
  image — **Image Generation** (`imagesEnabled`) — above
  three sub-menus: **Model** (backend, then key + model or the whole ComfyUI
  block), **Prompt Templates** (the template picker and everything a template
  holds: appearance rule · the four portrait clauses · negative prompt · style
  references), **Stored Images** (the purge).

  (Its second index setting, *1-Bit Shading*, went with the post-process it
  configured. `fields.tsx → SegmentedRow`, extracted for it, stays — Reasoning
  and Image Backend had each hand-rolled the same grid.)
- **Sub-menu depth** (`SubMenuScreen`) is local component state, not a `Screen` —
  routing it would put a dozen more entries in the navigation history for no
  gain. What the store owns is the Back claim (`setBackHandler`, so the Android
  hardware button behaves like the on-screen one) and the one-shot `section` deep
  link. Back pops to the index first, then out of the screen.
- **Characters screen** lists the global cast grouped by this adventure's standing — PC, then *In Party n/PARTY_LIMIT*, *Benched*, *NPCs & Allies*, *Gone*, and *Everyone Else* — each row opening the sheet and carrying one-tap moves (**Add to Party** / **Bench** / **Kick** / **Make NPC**). **+ New Character** creates someone in the library only. A filter box appears once the cast grows past 8.
- **Party screen** lists the company in two halves — *In the scene n/PARTY_LIMIT* (**Bench** / **Kick**) and *Benched* (**Activate** / **Kick**) — with a route to Characters when both are empty. The member sheet carries the same Kick/Add control, the adventure **standing** (active / benched / npc / departed / fallen) with a one-line explanation of what the current one means, **Revert Story Changes** when the story has diverged, and **Delete Character** (library-wide, player-only).
- **Member sheet order:** portrait → **Image Options** (a closed disclosure: upload · download · remove · the custom portrait prompt) → **Edit** → the sheet → **Story** (Auto-Update, and Revert Story Changes when the story has diverged) → **Condition** → **Standing** → leave/delete. Who the character *is* comes first and everything you can *do* to them follows: the sheet used to open with six buttons and an image-prompt fieldset, so a screen whose entire purpose is the prose underneath them made the player scroll past all of it to reach a name. Nothing was removed — the once-a-character controls fold away, the rest moved below the text they act on.
- **Member sheet fields:** Name · **Species** · **Sex** (both free text — the setting owns the vocabulary) · Appearance · Personality · Drive · Strengths · Flaws · **Notes** · Equipment, then the per-adventure **Condition** and **Standing**. **Notes** is the player's own field — no ✦, and no model writes it. In Edit mode the five *other* prose fields each carry a **✦ generate** button (see *Per-field generation*), and so does every **Equipment** row, beside its Remove (see *Item generation*); ✦ rather than ✨ because the sparkle is an emoji and browsers paint it in colour, which is one colour more than this app has — the same reason the portrait control is ⟳.
- **Style:** two colors only, monospace, square borders, no rounded corners, no gradients. Small token set in `theme.css` (`--ink`, `--paper`, shipped as `#000`/`#fff`) so it stays one system — the pair is the player's (Appearance → Colors), but everything still reads through those two tokens and nothing else.

### Reading area

This is a text game, and its chrome had grown to eat more than half a phone:
header + a 1:2 party strip + composer left roughly 350px for
prose, with the action options rendering *inside* that same scroll region so a
fresh beat was often pushed above the fold by its own suggestions. The fixes are
all about handing that space back:

- **Party strip** slots are **4:5**, not 1:2 — portraits are face-cropped
  (`origin-top scale-150`), so the extra height never showed more of anyone.
  They were 3:5 while the strip sat below the log; moving it **above** the
  reading area made every pixel it takes one the prose does not get, so the slot
  lost a quarter of its height. A party of nobody collapses the grid to a single
  row rather than standing empty dashed boxes on screen. There is **no name
  caption** under a face: portraits the player picked and generated are already
  recognisable faces, and the caption was a row of chrome repeating the picture.
  The name still reaches assistive tech via `aria-label`, and a tap opens the
  sheet that spells it out.
- **Landing on the beat, not its end.** When a completed beat is taller than the
  viewport, the log scrolls to its **first** line instead of pinning the bottom —
  pinning the bottom drops the player at the last paragraph of prose they have
  not read, with the options shoving the opening line off the top. Shorter beats
  keep the old tail-follow.
- **`Settings.textSize`** (pixels, Appearance) scales narration **only** — chrome
  keeps its sizes, so a large setting buys text rather than a blown-up
  interface. Prose leading went 1.3 → 1.6 (monospace at 1.3 is a wall), and
  player lines are no longer uppercased; the `>` and the rule already mark them.
- **Pinch-zoom is enabled again.** `maximum-scale=1.0, user-scalable=no` was a
  WCAG 1.4.4 failure with no in-app substitute; Text Size is the common case and
  zoom is the escape hatch.
- **Scene marks.** Every message has carried `day`/`location` since Phase 5 and
  nothing rendered them; the log now draws a rule naming the place and day
  wherever they change, so scrollback has landmarks.

---

## Build Phases

- **Phase 0 — Scaffold.** Vite + React + TS + Tailwind + Zustand + `idb` + Capacitor. 1-bit `theme.css`. This design doc. GitHub Actions APK build (learn from Wayward's `android.yml`; signed release, self-update-friendly).
- **Phase 1 — Core loop.** Settings (key + model). `prompt.ts` + streaming call + `<<<LOOM>>>` parse + truncate-at-`<<<`. Narration renders; options work; day/location/weather apply; autosave. (PC only, no party, no images yet.)
- **Phase 2 — Party + Spotlight.** Port `spotlight.ts`; party roster, portrait strip, member sheets, inventory view, fixed buttons, `detectSpeakers` → `lastSpokeTurn`. Dialogue segmenter (`Name: "…"`).
- **Phase 3 — Images.** `images.ts`; deterministic portrait triggers, IndexedDB blob store, regenerate buttons. Verify OpenRouter image-output shape first.
- **Phase 4 — Authoring + Saves.** Scenario editor, World Notes CRUD + keyword injection, narrator instructions, save slots (snapshot/restore/new). The pre-made scenario ships as the default.
- **Phase 5 — Polish + APK.** ✅ Reversal (`reversal.ts` pre-turn slice snapshot; `undoLastTurn`/`regenerateLastTurn`; `TurnControls`), error auto-retry (`retry.ts` policy + `streamChat` whole-stream restart, ported from Wayward), APK signing/CI (`android.yml`), mobile polish (overscroll lock, safe-area insets).
- **Foresight — arc ⟂ area ⟂ room (planned, not built).** `arc.ts` · `fronts.ts` · `areaPrep.ts` · `roomPrep.ts` · `promises.ts` · `gazetteer.ts`; boundary prep calls, client-owned clocks, the 1-bit map. See **Foresight — the arc, the area, the room**.

---

## Long-game memory

The rolling history window is a fixed token budget, so anything older simply
stops existing — which capped a campaign at roughly 15–25 turns. Three changes,
none of them a hidden summarizer:

- **The narrator writes its own World Notes.** `LoomBlock.notes`
  (`{ op, title, content, keywords }`) applies through `deltas.ts → applyNotes`
  and is gated back in by the existing `worldNotes.ts` keyword matcher — no new
  injection path. Notes are **player-visible and editable**, which is the whole
  argument for them over a rolling summary: a summary that quietly gets a fact
  wrong is unfixable, a note is one screen away. An `add` on a title that
  already exists **updates** it (the world learning more about a place it has
  already noted is the common case), keywords **merge** so the player's own are
  never dropped by an omission, and `permanent` is deliberately not writable —
  an always-injected note taxes every turn, so that stays the player's call.
  `applyNotes` copies lazily, because `captureReversal` reference-diffs the
  slice.
- **`Settings.historyBudget`** (Narrator → Memory) — the 3000-token budget was
  hardcoded and never passed by the store. It ships unchanged, but a
  large-context model can now be given far more.
- **`Settings.maxTokens`** — no `max_tokens` was ever sent, so "short and punchy"
  was a sentence in the prompt and nothing else. 0 restores no cap.

### Reasoning level (Narrator → Model)

`Settings.reasoningLevel` drives OpenRouter's unified `reasoning` field
(`settings.ts → reasoningParam`/`reasoningBody`), on the narration stream and the
non-streamed side calls alike — one text model, one thinking behaviour.

- **`auto` ships**, and is the only value that changes nothing: no `reasoning`
  field is sent at all, so a non-reasoning model sees the request it always saw.
  An unrecognised stored level falls into the same branch, because a value out of
  another build's localStorage must not reach the API and 400 every turn.
- **`off` is `{ enabled: false }`**, not `{ exclude: true }` — the point is a
  model that thinks (and bills) by default doing neither, and `exclude` only hides
  reasoning that still happened.
- **The effort levels carry `exclude: true`.** Nothing renders reasoning — the
  stream reads `delta.content` only — so returning the thinking text would be
  bandwidth spent on something dropped on arrival. It is not a discount: those
  tokens are still generated and still billed.
- Reasoning tokens count against `maxTokens`, so a tight beat cap plus a high
  level truncates the beat (and with it the `<<<LOOM>>>` block). The picker says
  so under the buttons rather than trying to reconcile the two numbers.

### The clock

`day` used to be a field the **narrator** wrote (`LoomBlock.day` straight into
`applyDeltas`), and nothing validated it: it could freeze for sixty turns, jump
three at once, or run backwards. `clock.ts` flips the authority — the narrator
emits a **duration**, the client owns every number.

- **A ladder of labels, never a number.** `moment · brief · scene · hour ·
  hours · halfday · day · night`, mapped to minutes on the client. An
  unrecognised label falls to the smallest one, so `ticks: 100000` is
  *unrepresentable* rather than caught — sanitising by type instead of by clamp.
  `"day"` left the output protocol entirely: one writer for time.
- **`moment` is non-zero**, so every turn ages the world. `applyDeltas` runs even
  when a block failed to parse, for the same reason — a turn the parser could not
  read must still move the clock.
- **`night` anchors rather than adds.** It advances *to* the next 07:00, because
  a fixed eight hours is wrong at both ends (bed at 21:00 wakes you at 05:00, bed
  at 02:00 wakes you at 10:00) and the fiction says "you wake at dawn" in both
  cases. Picked more than `MAX_ANCHOR_REACH` from the anchor it is clamped to an
  ordinary long duration — that label was a mistake, and honouring it would eat a
  day silently. A rest that lands the anchor sets `rested`, the journal's signal.
- **Time is a PHASE, never a clock face** — `phaseOf` gives eight bands, and both
  the player and the narrator see only those. A model handed "14:30" writes "at
  half past two" into the prose, which leaks an exact time to a player who is
  shown none, and implies clocks exist in a setting that may not have them.
  `minutes` is internal arithmetic and reaches neither.

### The journal

The window's eviction, caught. Written at a boundary the **client** picks — never
the model — and read off `GameState.messages`, the full transcript, so it still
sees the beats the model stopped being shown thirty turns ago.

- **Entries are terse lists**, not prose: 3–6 short past-tense lines, capped at
  write time. A day costs ~40–70 tokens instead of ~90.
- **Two authors, one shape.** `system` lines are derived here from
  `Message.appliedDeltas` — the same records `toasts.ts` reads for its chips — so
  quests, joins, departures, marks and moves are exact, free and unfakeable. The
  side call writes only what left no state change behind, with the facts handed
  to it as scaffolding and forbidden as output. Grounding a summariser on what it
  cannot invent is the cheapest accuracy available, and a failed call still
  leaves a usable entry.
- **The boundary is the long rest, not the calendar.** Rolling on midnight would
  cut a tavern scene in half; waiting for a `rested` turn that lands in a new day
  matches how a day is played. A turn ceiling covers the player who never sleeps,
  and a floor folds a too-short stretch into the next entry.
- **Created synchronously, written asynchronously.** The entry is opened with its
  facts *before* `captureReversal` snapshots, because a snapshot taken before an
  async append would restore to a state the entry was already in and undo would
  strand it. The late write re-reads the store and no-ops on a missing id, so
  undo wins the race.
- **Player-visible and editable**, which is the whole argument over a hidden
  rolling summary. Note the asymmetry: the model is shown a bounded, decaying
  tail; the player keeps every entry forever on the Journal screen. Same data,
  two products.

*Still deferred:* rolling LLM summarization of the beats themselves. Between the
narrator's own World Notes (facts, keyword-gated, unbounded) and the journal
(events, chronological, bounded), the ground it would cover is taken — and both
of those stay inspectable, which a rolling summary never is.

---

*Deferred (not MVP):* NPC/item art, TTS, weather animation, multi-world.

---

## Foresight — the arc, the area, the room

**Status: designed, not built.** Nothing below exists yet; this section is the
spec.

The journal remembers backwards. **Foresight remembers forwards** — and it is
built the same way, deliberately: the model authors at a **boundary** the client
picks, the client owns every number, the artefact is **player-visible and
editable**, it is injected **after** the history, it is bounded by caps, and when
it is absent the turn is byte-identical to one taken without it.

The gap it fills: the narrator has memory but no **intent**. Every block it emits
is backward-looking, so when `stakes.ts` hands it a `cost` band it invents the
cost on the spot — and an improvised cost is a generic cost. Nobody decided in
advance what failure *means here*. The same is true of success: a `strong` grants
the request and changes nothing.

It also stops throwing away foresight the app already pays for. The narrator
writes 3–4 `options` every turn. That is one-step lookahead, and the client
renders the buttons and discards the thinking behind them.

### Three scopes

|                 | **Arc**                                   | **Area**                                        | **Room**                                     |
| --------------- | ----------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| example         | *the consortium is buying the valley*     | Murkwood                                        | Forest Entrance                              |
| authored by     | the scenario, then the model               | the model                                       | the model                                    |
| fires on        | New Adventure · spine fires · handoff      | entering an unprepped or stale area             | entering an unprepped room · turn ceiling    |
| lifespan        | sessions; archived on completion           | the campaign (cached, revisited)                | the campaign (cached under its area)         |
| owns            | **fronts + clocks** · the story's question | region texture · standing threats · **its front** | this space · threats · hooks · **`outcomes`** |
| calls           | ~1 per in-game day                         | 1 per area, ever (until stale)                  | 1 per room, ever (until stale)               |
| reads           | scenario · PC · journal · fronts           | **the arc** · scenario · matched World Notes    | **the area** · last 2 beats · promises · party flaws |

**Only the room carries outcome bands.** A band resolves in a space, never in an
arc; the two upper scopes exist to make that one line specific rather than
generic. Extra calls, all off the critical path: **zero per turn.**

### The loop — Prep → Play → Reckon

```
 boundary                    turn                          after the block applies
 ────────                    ────                          ──────────────────────
 PREP call ──> card ──────> injected PRIVATE ──> narrator spends ──> RECKON (no call)
      ↑          │               │                                        │
      │          └── outcomes{strong,mixed,cost} ──> OUTCOME block ────────┤ cost ticks a front
      │                                                                    │ promise planted
 ARC call <── fronts + promises + journal <─────────────────────────────────┘ promise paid
  (day boundary)
```

Each artefact has **exactly one writer**, which is the `day` lesson generalised:
two writers for one number is how the day came to freeze, jump and run backwards.
The model authors *material*; the client owns *arithmetic, clocks and geometry*.

### 1. The arc — `Scenario.arc` ⟂ `GameState.arcs`

Split the way the project already splits people (see **Characters ⟂ Party**):

- `Scenario.arc` — the **authored** arc. A template. Rides the scenario through
  New Adventure's import ticks, so a shipped scenario opens with a real arc and
  no new tick is needed in `AdventureImports`.
- `GameState.arcs[]` — the **instances**. Ticks, status, what actually happened.
  A **list, appended**: a completed arc is archived, not deleted, so the Arc
  screen doubles as campaign history and `JournalEntry.arcId` gives the journal
  the chapter structure it has never had (*Arc I — The Drowned Gallery*), which
  is the legibility a 300-turn journal screen is missing.

**Completion is client-owned and deterministic.** The arc names one front as its
**spine**; the other fronts are texture. When the spine fires, the arc resolves.
The model never declares a story over, for the same reason it never ticks a
clock.

**The interlude is a state, not a scene.** `Arc.status: "running" | "interlude" |
"done"`. While it holds:

- **front ticking is suspended** — cost bands and neglect alike. Nothing looms.
- the prep block is replaced by an `INTERLUDE` block: *no threats, no clocks,
  breathing room; let them talk*.
- spotlight pressure is raised — companions are the content.
- it is the natural firing point for **Auto-Update** (personality re-read after
  the thing that changed them) and for the journal to close the arc.

It ends on `interludeTurns` or a player *move on* — both, because suspending
every clock is exactly the pressure release the idea wants and also a state a
player can sit in for forty turns.

**Handoff** then runs one call: journal + closed arc + cast + World Notes → the
next arc, its spine, its fronts. This is the highest-stakes call in the system —
it writes the next several hours of play off a summary — so it is the one that is
**staged, not applied**: previewed on the Arc screen with Use / Regenerate, the
same shell as `GenerateModal` and the ✦ flows. The player will want to co-author
it.

### 2. The area

An area card is the region's pressure: what it is like, what applies anywhere in
it, and **which front it serves** (rooms inherit that, rather than each room
picking one and drifting).

It also ships a list of **room names** — names only, no content. Cheap, and it
buys four things:

1. the narrator stops renaming the same place, because it has a list to move you
   to;
2. room prep gets a hint (*you are prepping Forest Entrance, one of: the Stile ·
   Wardens' Camp · Drowned Gallery*);
3. it is the map's skeleton — an area is drawable before it is walked;
4. unlisted rooms still work: the narrator invents one and the client appends it.
   A list is a seed, not a fence.

A named room that is never visited is not a ghost, it is a rumour, and rumours
are hooks — so unvisited names survive a re-prep. Capped (≤8) so they cannot
accumulate.

### 3. The room, and the join to `stakes.ts`

The room card is the only one with `outcomes`, keyed by `TurnOutcome` — the same
three keys `stakes.ts` already bands to. That is the whole join: no new prompt
block, no new mapping. `formatStakesBlock` gains one line.

```
OUTCOME — COST · 1d6 2 −1 = 1
Prepared for this scene: the stair collapses, the ankle turns, and the landlord
upstairs now knows.
```

**The narrator is shown only the branch that rolled.** The two it did not roll
never enter the context, so there is nothing to hedge toward and nothing to leak.
A quiet turn rolls nothing and gets no line at all, exactly as today.

Shipped prep instructions say a `strong` must **change the scene, not merely
grant the request** — that is how success gets interesting, and it is one
sentence of a player-editable field.

The room also carries **`exits`** by name. Worth it independent of the map: "the
ways out are the stile, the track back, the deer path" is precisely the concrete
geography the narrator contradicts itself about three beats later.

### Promises and option notes

Two cheap channels on the turn block itself, and the turn contract barely moves —
which matters, because `loom-turn-protocol` is a guarded contract and weak models
already drop the block (see **enforced action options**).

- **`optionNotes: string[]`** — parallel to `options`, same length: what each
  choice risks. Never rendered. When the player takes that option, the note comes
  back next turn as *you planned this*. **A length mismatch drops them all** —
  misaligned notes are worse than none. `mergeRepairBlock` takes them only
  **paired** with `options`.
- **`promises: [{ op, text }]`** — the commitment the prose just made ("the
  tremor in the walls"). Client stamps the turn, ages it, escalates the wording
  at `promiseTurns` (*pay it off or let it go*) and drops it at twice that. Area
  and room prep both read the outstanding ones, which is the wire that turns a
  promise into a threat into a rolled band into a front tick — one chain.

There is deliberately **no `fronts` and no card field on the turn block.** Those
are authored at boundaries only.

`reconcileBlock` folds the new channels under the rule it already applies: an op
that changes nothing is not an op — a `remove` for a promise not held, an `add`
for text already promised.

### Reckon — client-owned, no call, inside the reversal snapshot

Runs after `reconcileBlock` → `applyDeltas`, folded into the same `nextGame`, so
it rides the **same save and the same `captureReversal`** — exactly how a
`condition` rides the roster.

- `cost` in a room whose area serves front F → **F ticks 1** (`costTicksFront`,
  on). `mixed` ticks 0 by default (`mixedTicksFront`, off).
- **Neglect:** a front unticked for `frontNeglectDays` in-game days ticks 1. The
  clock is `clock.ts`, which the client already owns. This is what makes the
  world move while the player does something else.
- `ticks === steps.length` → the front **fires**: the next turn carries a
  mandatory block (*THE FLOOD ARRIVES — write it into this beat*), the front goes
  `fired`, and the next arc review authors the aftermath. If it was the spine,
  the arc goes to interlude.
- Promises plant, close and age here too.

Front ticks and promise plants are **client-computed, so they do not belong in
`Message.appliedDeltas`** — that array is a record of what the model said.
`Message.reckoning` carries them, and `toasts.ts` reads it for chips.

### Epochs — staleness, invalidated lazily

An arc that advances makes every area prepped under it wrong.

```
Arc.epoch++        on: a front fires, a front retires, handoff rewrites the question
AreaCard.epoch     stamped at prep; a mismatch marks the area stale
AreaCard.version++ on re-prep; marks its cached rooms stale
```

Stale is a **flag, not a purge.** Re-prep happens on next *entry* — never
eagerly, because a call spent on an area nobody is standing in is a call wasted.
The player sees the flag on the screen and can force ↻.

### Injection — one private message, tier 4c

Between **STATE OF PLAY** and the **OUTCOME** block, because the outcome line
refers to the card. It gets its own message rather than joining the state tier
for a reason the tier order already encodes: the state tier's authority line
claims *"where this disagrees with a beat, this is what is true now"*, and prep is
**direction, not fact** — the same category as `formatRegenerateNote`.

```
NARRATOR'S PREP — private. Yours, not the player's. Never quote it, never list
it, never name a threat that has not happened.

ARC — the consortium is buying the valley, and the wardens know
  the mine floods  ●●○○  next: the lower gallery is cut off
  the warden turns  ●○○○  next: he stops answering letters

AREA — Murkwood
  old growth, wet, nobody logs here any more; the wardens patrol at dusk
  standing: anything loud brings a patrol within the hour

ROOM — Forest Entrance
  the cart track ends at a stile; sightlines die ten feet in
  threats: the stile is watched · the mist eats sound both ways
  here to want: the warden's mark cut into the post
  ways out: the Stile · the track back · the deer path

PROMISES — the tremor in the walls (6 turns ago) — pay it off or let it go
YOU PLANNED THIS — "the stair takes weight it shouldn't"
```

Three tiers is where **every fact is stated once** goes to die, so it is enforced
at *authoring*, not display: area prep is shown the arc and told not to restate
it, room prep is shown the area and told not to restate it. Caps do the rest
(`AREA_MAX_THREATS 2`, `ROOM_MAX_THREATS 3`, per-line character caps in the
`JOURNAL_MAX_LINE_CHARS` mould). Target for the whole block: **≤ ~150 tokens**,
smaller than one beat.

Only the arc's **next** step is shown, never the remaining ones — the rest is
spoiler for the narrator and noise in the budget.

### Reversal, determinism, degradation

- **Prep is not state, so reversal does not snapshot the gazetteer.** It captures
  the *pointers and the clocks*: current area key, current room key,
  `front.ticks`, promises, arc status. Undo puts the player back in a room whose
  card is still in the cache — no re-prep, no double tick, and the snapshot stays
  small.
- Cards are authored at **boundaries**, not per turn, so `regenerateLastTurn`
  re-tells the same turn against the same prep. Same rationale as seeding the
  dice on `(turn, action)`.
- A prep result carries the key it was prepped for; a card landing for a scene
  the game has already left is **dropped**. Direct copy of the journal's
  `appendModelLines` no-op-on-missing-id.
- `normalizeArc` / `normalizeAreaCard` / `normalizeRoomCard` sanitize at **READ**,
  in the `normalizeDice` stance — clock size pinned to 2–8, `ticks` pinned inside
  `0..steps.length`, steps beyond the clock dropped, lines truncated, exits
  naming an unknown room dropped. Garbage unrepresentable rather than clamped.

| failure                            | result                                            |
| ---------------------------------- | ------------------------------------------------- |
| prep call fails or lands late      | no card → **turn byte-identical to today**        |
| arc review fails                   | fronts stand; clocks still tick (client owns them) |
| `optionNotes` length mismatch      | dropped whole                                     |
| `promises` omitted                 | nothing planted; existing ones still age          |
| no `area` on the block             | falls back: compound `location` → the area you were in |
| `foresightEnabled` off             | zero new tokens, zero new calls, prompt as today  |

A save with no `area` — which is every save written before this — has an empty
arc and no areas, injects the room tier only, and behaves as single-scope
foresight. The simpler design is the degenerate case, so there is no migration.

### The map

Two grids, unrelated to one another: a world grid for areas, a local grid inside
each area. No zoom continuity between them, as in every CRPG that has ever
shipped two maps.

**The rule that makes it safe is already in the codebase:**

> Coordinates are internal, like `GameState.minutes`. The narrator never sees a
> number — it sees `exits` by name. The player sees the map.

Exactly the phase-word rule from **The clock**: a model shown `14:30` writes "half
past two" into the prose; a model shown `x:3, y:-1` writes cardinal directions and
then contradicts them two beats later. The model authors material; the client
computes geometry.

`normalizeMap` runs at READ:

- coordinates clamped to a bounded grid (−16…16);
- **two rooms on one cell → the later one is pushed to the nearest free cell by a
  deterministic spiral.** Models are poor at spatial consistency, so collisions
  are assumed rather than trusted against;
- exit edges made symmetric; an exit naming an unknown room is dropped.

Rendering is where the app has an unfair advantage: **1-bit, so the map is free
and exactly on-brand.** CSS grid or inline SVG, no image model, no `images.ts`
involvement at all. Filled cell = visited · outline = named but unvisited ·
current room inverted · exits as rules between cells. `mapFog` toggles whether
rumoured rooms show.

**It is a play screen, not a prep screen** — the ⋯ quick menu beside Party,
Inventory, Journal and Saves. The map is the *player's*; the threats stay private
on the Foresight screen. Player-editable like everything else: dragging a room
writes its cell, since the client owns the coordinates anyway.

Optional and nearly free: `Arc.areas[]` tags the regions an arc touches, so the
world map can shade them. One field, and the campaign becomes visible.

### Data model

```ts
// Authored, frozen, rides the scenario import. The template.
interface ArcTemplate {
  question: string;              // what this story is about, one line
  fronts: FrontTemplate[];
  spine: string;                 // FrontTemplate.id — the front whose firing ends the arc
}

// The instance. GameState.arcs — appended, never replaced.
interface Arc extends ArcTemplate {
  id: string;
  epoch: number;                 // bumped when a front fires/retires or handoff rewrites
  status: "running" | "interlude" | "done";
  fronts: Front[];
  areas: string[];               // AreaKeys this arc touches (map shading)
  openedTurn: number;
  interludeFrom?: number;        // turn the interlude began
}

interface Front {
  id: string;
  label: string;                 // "the mine floods"
  steps: string[];               // written in ADVANCE; length is the clock, 2..8
  ticks: number;                 // CLIENT-owned. The model never writes this.
  lastTickDay: number;           // neglect hangs off clock.ts
  status: "open" | "fired" | "retired";
}

// GameState.areas — the gazetteer, keyed by AreaKey.
interface AreaCard {
  key: string;
  name: string;                  // "Murkwood"
  epoch: number;                 // the Arc.epoch it was prepped under
  version: number;               // bumped on re-prep; invalidates its rooms
  coord: Coord;                  // world grid — internal
  neighbours: string[];          // AreaKeys
  texture: string;               // one line: what this region is
  threats: string[];             // <= AREA_MAX_THREATS, applies anywhere in it
  front?: string;                // Front.id this area serves; rooms inherit
  rooms: Record<string, RoomSlot>;
}

interface RoomSlot {
  name: string;                  // known from the area's list, possibly unvisited
  coord: Coord;                  // local grid — internal
  exits: string[];               // RoomKeys; symmetric after normalizeMap
  visited: boolean;
  card: RoomCard | null;         // null = named, never entered, never prepped
}

interface RoomCard {
  version: number;               // the AreaCard.version it was prepped under
  openedTurn: number;
  danger: string;                // one line: what this space is
  threats: string[];             // <= ROOM_MAX_THREATS: the thing + what sets it off
  hooks: string[];               // <= 2: what is here to want
  outcomes: Record<TurnOutcome, string>;   // SAME keys as stakes.ts
}

interface Promise {              // GameState.promises
  id: string;
  text: string;
  plantedTurn: number;
}

interface Coord { x: number; y: number }

// On the turn block / message:
interface LoomBlock  { area?: string; optionNotes?: string[]; promises?: PromiseDelta[] }
interface Message    { optionNotes?: string[]; reckoning?: Reckoning }
interface Reckoning  { frontTicked?: string; frontFired?: string; promisesPlanted?: string[] }
```

`GameState.location` stays the **room**. `deltas.ts → simplifyLocation` already
splits a narrator-stapled compound on `LOCATION_JOINERS` and keeps the last
segment — the app has been separating area from room since **one-name locations**
and discarding the left half. The rule stays; it stops throwing that half away.

### Modules and screens

```
src/lib/arc.ts        spine · completion · interlude state · buildArcMessages · parseArc · normalizeArc
src/lib/fronts.ts     tickFronts · neglect · firedFront · formatLoomingBlock
src/lib/areaPrep.ts   areaChanged · buildAreaMessages · parseAreaCard · normalizeAreaCard
src/lib/roomPrep.ts   roomChanged · buildRoomMessages · parseRoomCard · normalizeRoomCard
src/lib/promises.ts   plant · close · age · formatPromisesBlock
src/lib/gazetteer.ts  keys · lookup · staleness · normalizeMap (coords, collisions, exits)
prompt.ts             formatForesightBlock — tier 4c, joins arc + area + room + promises + option note
stakes.ts             formatStakesBlock gains the prepared line for the band that rolled
```

Pure and tested; only the store touches the network — the same discipline as
`clock.ts`, `journal.ts` and `stakes.ts`, and the same reason.

- **Menu → This Adventure → Foresight** (`SubMenuScreen`): **Arc** (question,
  spine, fronts with editable steps and manual ticks, past arcs, staged handoff
  preview) · **Area** (this area's card, stale flag, ↻) · **Room** (this room's
  card, ↻) · **Promises** (close / drop).
- **Map** — a *play* screen, in the ⋯ quick menu with Party, Inventory, Journal
  and Saves.
- **Menu → Settings → Narrator → Memory**, beside the journal's controls, because
  it is the same feature pointed the other way: `foresightEnabled`,
  `scenePrepInstructions`, `areaPrepInstructions`, `arcInstructions`,
  `promiseInstructions` (each folded into the output protocol as a whole bullet
  that a blank field removes), `sceneBoundaryTurns`, `frontNeglectDays`,
  `promiseTurns`, `interludeTurns`, `costTicksFront`, `mixedTicksFront`,
  `mapFog`.

Save slots freeze all of it for free (it rides `GameState`), cloud saves carry it
in the slot document, and absent fields read as empty — so there is no migration
on either side.

### Open questions

- **Room prep as a call, or derived?** A `derive` mode — the area pre-writes room
  seeds and the client picks one deterministically, zero calls — would serve
  players on cheap models. Quality is almost certainly worse; worth measuring
  before deciding.
- **Area cards overlap World Notes.** Both are keyed by place, both editable,
  both injected. The distinction that holds: a World Note is **public and
  keyword-gated** (facts, readable anytime), an area card is **private and
  location-gated** (threats, unspent consequence, only while you stand there).
  The wire between them: leaving an area deposits a short *public* note
  (*Murkwood — the wardens patrol at dusk*) while the threat material stays
  private — the same retirement shape as beats → journal. Decide before building,
  or the player maintains the same place twice.
- **Player-authored arcs.** The Arc screen is appealing enough on its own that
  "write your own campaign outline, the model fills the gaps" may be the primary
  mode rather than the escape hatch.
- **How often a boundary really fires** in play. Room granularity absorbs most of
  what a turn ceiling was covering, but a 30-turn tavern conversation is one room
  and still needs the ceiling to refresh its card.

---

## Cloud saves — `src/lib/sync.ts` · `syncEngine.ts` · `supabaseClient.ts`

The device *is* the database (IndexedDB + localStorage), which means an
adventure is stuck on the device it started on. The cloud is where the player's
**named snapshots** live: take a save on one device, restore it on another.
**Opt-in** (`Settings.syncEnabled`, off by default) and additive — with it off,
nothing about the app changes and no request is made, and the SDK is a lazy
`import()`, so its ~130 KB is not even in the main bundle.

**Cloud SAVES, not a live mirror.** This started as a mirror of the whole device
— the active game pushed on a 5s debounce after every write — and that was the
wrong shape for a single-player text game. It re-sent the entire transcript on
every beat (there is no delta protocol), uploaded every generated portrait
whether anything needed it or not, ran a pass each time the app came
back to the foreground, and needed a conflict prompt, two rescue snapshots and
an "is this game untouched?" heuristic purely to cope with two devices playing
the same live game. The app already had the primitive that answers all of it:
**Saves**. So the live game stays on the device it is being played on, and what
travels is what the player deliberately saved. A snapshot is an explicit,
legible act — "Save Snapshot" *is* "back it up".

What that removes: the `active` document, the conflict prompt and its modal, the
rescue slots, the `busy()` port that kept a pass off a streaming turn, and the
per-turn network cost, which is now **zero**.

**The remote shape is deliberately dumb** (`supabase/migrations/`): one
key/value table `loom_docs (user_id, key, doc jsonb, deleted, device,
updated_at)` and one private Storage bucket `loom-images`. The keys are
`settings` · `slot:<id>`; images are objects at `<user_id>/<base64url(cache
key)>`, encoded because a cache key is free text ("portrait:<uuid>").
Every policy is `auth.uid() = user_id` — the anon key ships in the app, as it is
meant to, and RLS is what protects the data. `updated_at` is stamped by a
trigger, never by the client: it is the merge clock, and two phones disagree
about what time it is.

**Merging is a watermark, not a clock comparison.** Each key carries a
`DocStamp { localAt, syncedAt, remoteAt }` in a `meta` store (DB v3) —
`localAt > syncedAt` means "changed here since the last sync",
`remote.updated_at !== remoteAt` means "changed there". `planDoc` turns that
into `push | pull | conflict | none`, and it is pure and unit-tested, because a
wrong answer here loses a save. `localAt` is written inside `db.ts`/`settings.ts`
rather than at the call sites, so a snapshot taken on a plane still looks changed
after a restart. **`saveActiveGame` is deliberately unstamped** — the live game
has no cloud copy to be newer or older than.

**Nothing asks.** A `conflict` settles on the newer write in both directions
(`newerSide`), because there is no longer a document where both answers are real
games somebody played. A slot used to take the server's copy on the grounds that
a snapshot is immutable; **Overwrite** made that false, and "I saved over this on
both devices" has an obvious answer. Images settle the same way, silently — two
versions of a portrait are not two stories — and a local deletion propagates as a
delete rather than being undone by the other device's copy.

**A pass is provoked by four things and no others**: a snapshot being taken,
replaced or deleted; a settings edit; app launch / sign-in; and **Sync Now**.
That is `sync.ts → wakesSync` — `dirty.ts` announces every local write with its
key, and only `settings` and `slot:*` wake the engine. Turns, journal entries and
generated art announce themselves and are ignored. There is no
`visibilitychange` pass any more: foregrounding was worth a round trip when the
cloud held a game that might have advanced elsewhere, and is not worth one when
the cloud holds snapshots that only change when somebody presses Save. Passes
stay single-flight, debounced 5s, with backed-off retries on failure.

**Images are scoped to the saves.** `images.ts → slotImageKeys` names the art one
saved game needs — its cast's **frozen** portraits (`slot:<slotId>:portrait:<cid>`, the copies the
snapshot took, so a slot pulled from another device lands under its own keys instead of
overwriting the portraits of the game being played here) — and `planImages` gates upload and
download on the union of those keys across the slots on **both** sides (a cloud
slot's body is already in hand from `pullDocs`, so knowing what to download costs
nothing). The blob store also holds the portrait of everyone a long game ever
met, and nobody restores to those. Deletions are **not** gated, or *Remove Image* and the purge
buttons would stop reaching the cloud the moment a key fell out of scope. No
remote garbage collection — an object no slot names is left alone rather than
deleted on an inference, and Images → Stored Images → Purge is how the player
says it out loud.

**Retired keys are skipped, not tombstoned** (`sync.ts → SKIPPED_DOCS`): `active`
(the live game) and `characters` (the cast, from when the library was global). A
stamp with nothing local behind it reads as a deletion, and pushing that tombstone
would wipe the game — or the cast — out from under a device still running an older
build. Both rows are left exactly where they are, forever. There is no migration:
`loom_docs` is a dumb key/value store and the server side is unchanged.

**Ordering rule:** a stamp is written only after the bytes land. A crash mid-pass
leaves a key looking dirty and costs one redundant transfer; the opposite order
would mark a document synced that never left the device.

**What does not travel:** the game in progress; `supabaseUrl` / `supabaseAnonKey`
(this device's way in — a blank override pushed from one device would lock out the
other); and `comfyUrl` (a LAN address that means a different machine elsewhere).
The OpenRouter key *does*, by choice, so a new device is playable the moment it
signs in. Added web fonts are re-added per device — the `webFonts` list syncs, the
woff2 files do not.

---

## Verification

- **Unit tests (vitest)** on the pure ports — the highest-value safety net, mirroring Wayward's test targets:
  - `spotlight.ts`: `_member_spoke` / `detectSpeakers` (name-mention vs actual dialogue), signal computation, group-address detection.
  - `prompt.ts`: block ordering, history trimming to budget, opening-narration prepend.
  - `<<<LOOM>>>` parser: tolerant salvage, block always stripped from prose, options parse.
- **Manual end-to-end on device/emulator:** start the pre-made scenario → take several turns → confirm short punchy narration, working options + fixed buttons, portraits appear for party, spotlight voices addressed members and stays quiet otherwise, save/load round-trips, everything editable in Settings.
- **APK smoke test:** install the CI artifact, run a full turn with a real OpenRouter key.

---

## Open items to confirm during build (not blocking)
- Exact OpenRouter **image-output** request/response shape for Nano Banana 2 Lite (verify against live docs).
- Default **text model** to ship in Settings (uncensored/roleplay-tuned; user picks their own key anyway).
- Whether the single active-game + snapshot-slots model (chosen here for simplicity) is preferred over a Wayward-style world/adventure split.
