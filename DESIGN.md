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
moves, generates **1-bit pixel-art portraits and location banners** via an image model.

### Locked decisions (from design Q&A)
- **Client-only, no backend.** One app; the phone calls OpenRouter directly; all logic + saves are on-device.
- **One pre-made scenario**, fully editable in Settings. Inline editing everywhere — no Edit mode.
- **Images via OpenRouter** (Nano Banana 2 Lite). Scope: **party portraits + location banners**, generated on demand, player can **regenerate**.
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
| Cloud sync | **Supabase** (Postgres + Storage), opt-in | mirror of the same documents, so a game resumes on another device |
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
- **`location` is ONE place name, the most specific one.** The protocol says so ("Damp Cellar", never "Boars Head Tavern - Damp Cellar"), and `deltas.ts → simplifyLocation` enforces it on the way in: a compound joined by ` - `, ` — `, ` / `, ` > `, ` | ` or `: ` keeps only the **last** segment, since with those joiners the tail is the narrower place. Prompt wording alone wasn't enough — the location is a scene label *and* the banner's cache key, so "Tavern - Damp Cellar" is a different key from "Damp Cellar" and the same room gets drawn again every time the model changes its mind about the prefix. Commas are deliberately **not** joiners ("Rodstroke, Mesmeria" nests the other way round), and a hyphen without surrounding spaces is part of a name ("Half-Moon Inn"). A location that is nothing but separators leaves the scene unchanged.
- `party` ops match **by name across the whole cast**, so a companion from an earlier adventure is re-used, not duplicated. **A sheet is authored once, at creation, and frozen after**: only an `add` naming someone genuinely new writes `species`/`description`/`personality`/`drive`/`strengths`/`flaws` **and their starting `equipment`** (straight onto the new `Character`) — the narrator kits a companion out from the appearance it just wrote, and the gear is the player's from then on. Every later op — `add` or `update` — carries `standing` and nothing else; sheet fields on a character who already exists are dropped. An `add`/`update` may carry `"standing": "active" | "benched" | "npc"`, and a `remove` `"standing": "departed" | "fallen"` — nothing the model emits ever deletes anyone. See *Characters ⟂ Party*.
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
One isolated function returning the OpenRouter `messages[]`, in order:
1. **Core narrator instructions** (Loom role: short punchy second-person shonen adventure, uncensored, sandbox) + player **custom instructions** appended.
2. **Scenario / premise** (the editable pre-made scenario).
3. **PC summary** + equipment text fields.
   Every character block — PC, party roster, NPC sheet, and the side-call sheets — leads with the same identity line, `Name (species, sex)`, from `roster.ts → formatIdentity`; blank traits drop out.
4. **Party roster** — the `active` members only: description, personality, drive, Strengths, Flaws, equipment (port `_format_equipment`, simplified to `{label, description}` — no catalog lookup). Benched members get no sheet; they are not in the scene.
5. **Inventory** (compact `label ×qty — description` list).
6. **Active quests** (compact `label — description (reward: …)` list; done quests omitted).
7. **World Notes** matched by keyword (single-category, simplified `match_entries`; titles are implicit keywords; scan the new message + last few turns). Notes flagged **permanent** skip matching and inject every turn.
7b. **Known characters** (`cast.ts`) — the sheets of `npc`-standing allies the scene just named, matched with the same `keywordHits` as the notes and capped at `NPC_LIMIT`. Gated, not always-on: an adventure can know fifty people without any of them costing a turn they're absent from.
8. **Spotlight block** (from `spotlight.ts`) — over the `active` members only.
9. **Chat history** window (trim to a token budget; prepend the opening narration as the first assistant turn — port `_trim_to_budget`).
9b. **Journal** (`formatJournalBlock`) — what already happened, newest first, under its own budget. Placed *after* the history because it is the older material: the window holds the last few beats verbatim, and this is the stretch behind them the window has already dropped. Not keyword-gated (a journal is chronological, not topical); bounded by construction instead, with entries past `JOURNAL_PROSE_ENTRIES` decaying to their client-derived facts before dropping out.
10. **Active-party roll call** (`formatPartyComposition`) — the *authoritative* composition, re-read from the roster **every turn** and placed **after** the history on purpose: history outlives membership, so the last thing the model reads before the action is who is actually here. Names the `active` members `n/PARTY_LIMIT`, the `benched` ones under an explicit "NOT in this scene", the most recent departures with their `standing` (`partedMembers`) so the narrator stops writing them in — and never resurrects a `fallen` one — and every `npc` by name, so an ally is never forgotten between the turns that reach them. **Always emitted, even for an empty party** ("the player is ALONE") — the empty case is exactly where the history drifts.
11. **Output-protocol instruction** — how to emit prose + the `<<<LOOM>>>` block, and the `option` instruction (player-editable).
12. **Player's new message.**

---

## Image Generation — `src/lib/images.ts`

- **Access:** OpenRouter chat-completions with an image-output model (Nano Banana 2 Lite), reading the returned image (base64 data URL) from the response. *(Exact request/response shape for image output over OpenRouter must be verified against current OpenRouter docs at implementation time — flag, don't assume.)*
- **Two backends, one seam (`Settings.imageBackend`, Model & Key):** `generateImage` is the only function in the app that turns a prompt into pixels, so a second backend is a dispatch inside it and nothing else changes — the 1-bit pass, the `src:` master, the IndexedDB cache, the placeholder and the failure badge never learn which machine drew the picture. **OpenRouter** is the default and is untouched. **ComfyUI** (`src/lib/comfyui.ts`) points the same two deterministic triggers at a server the player runs themselves: free to render, their own checkpoints, and no network round-trip to a vendor. See **ComfyUI** below.
- **Two kinds, deterministic triggers (not model-driven):**
  - **Location banner** — keyed by `banner:<location>`. On a scene change to an **uncached** location, generate from location name + a short narration excerpt + the **banner style instructions**. Gated by `Settings.locationImages`, see below.
  - **Party portrait** — keyed by `portrait:<memberId>`. When a member has no portrait, generate from their name/species/**sex**/description + the **portrait style instructions** — *unless* the player removed it (`Character.noPortrait`), see **Remove** below. Sex is in the Subject because an image model given only prose guesses, and guesses differently on every regenerate.
- **Style baked in:** default banner/portrait instructions enforce **1-bit monochrome pixel/line art**. Player-editable under Advanced → Image Prompts, as one of several **templates**, see below.
- **Master switch (Model & Key → Image Generation, `Settings.imagesEnabled`, ON by default):** one setting that stops *every* request to the image model — portraits, banners, ⟳ and ✎ alike. `locationImages` only ever governed half the spend, and the other half had no switch at all: a player who didn't want to buy pictures had to turn location images off and then *Remove Image* on every character, one at a time, forever, because the automatic trigger redraws whatever isn't cached. The gate is on **generation only** and reads the same as the banner cooldown does — `imagesAllowed`/`bannerAllowed` in `images.ts`, folded into the existing `cacheOnly` flag, so `syncImages` degrades to a cache probe and everything already drawn still shows. Uploads, downloads, *Remove Image* and the zoom view all keep working (none of them talks to a model); ⟳/✎ hide, `regenerateBanner`/`editImage`/forced portraits no-op, the banner's cooldown countdown stops being displayed (that wait would never end), and the Image API Key + Image Model fields hide under the switch that made them dead. Nothing stored is deleted. Ships **on** because portraits have always drawn themselves — shipping it off would read as a broken pipeline, not a saving.
- **Location images off by default (Advanced → Images → `Settings.locationImages`):** the whole banner feature is opt-in. Portraits are drawn once per character and then reused forever; a location banner is a fresh generation every time the story moves somewhere new, which makes it the app's most expensive habit and the one furthest from the text the player came for. Off means **no generation and no UI**: `syncImages` skips the banner entirely (cached or not), `regenerateBanner` no-ops, `<Header>` falls back to the plain single-height ink strip (no art, no image controls), and the Menu's *Compact Location Image* toggle and the Advanced cooldown field are hidden rather than left as dead controls (the banner *style* is part of a prompt template and stays editable — a template is a whole dialect, not a per-feature setting). Nothing is deleted — already-generated banners are still in IndexedDB and reappear the moment it's switched back on. Portraits are unaffected.
- **Location image cooldown (Advanced → `Settings.bannerCooldown`, 0 = off):** turns to skip automatic banner generation for after one is drawn — `3` means the next 3 turns draw no new location image, the 4th does (`bannerOnCooldown` / `bannerCooldownLeft`, counted from `GameState.lastBannerTurn`). A location-hopping stretch otherwise bills one generation per turn, which is the single easiest way to burn image credit without noticing. Three deliberate limits: the gate is on **generation only**, so an already-cached location still shows its banner instantly; the stamp is written on a real generation only, never a cache hit, so re-treading known ground doesn't stall the next new one; and **`regenerateBanner` ignores the cooldown** (but restarts it — it *is* a generation; no longer reachable from the bar, see *Top bar*). While suppressed the banner placeholder says how many turns are left, so it never reads as a broken image. `lastBannerTurn` is deliberately outside `Reversal` — an undo can't un-spend a generation.
- **Regenerate:** ⟳ on each member sheet (and `regenerateBanner` in the store) re-runs generation and **replaces the cached blob and its master** — generated, edited, or uploaded, whatever is there loses. A forced regeneration that fails flags `imgError` (an *image failed* badge) **with the reason** — "failed" alone is unactionable, and the causes are wildly different (no credit, a refused prompt, an unreadable file). ⟳ also clears `noPortrait`.
- **Edit (✎):** instruction + the image back to the model; the result **becomes** the new image (display copy *and* master). The edit source is the master, never the display copy — handing a model a 192px 1-bit thumbnail comes back as mush or as a text-only reply that fails the edit outright.
- **Remove (member sheet):** *Remove Image* deletes a member's portrait **and its master**, revokes the object URL, and sets `Character.noPortrait` on the global character. The flag is the whole point: the automatic trigger is "no cached portrait → draw one", so without it the next turn's `syncImages` would silently undo the removal. It's a character-level choice (a portrait is shared across adventures), and only ⟳ or an upload clears it.
- **Upload / download (member sheet):** *Upload Image* replaces a member's portrait with a file from the device — put through the same downscale + 1-bit pass as a generated portrait, so custom art lands in the same visual system and stays small in IndexedDB (with shading **off** it keeps `UPLOAD_PLAIN_WIDTH` instead of the 1-bit pixel width: no pixel grid to snap to, so crushing it that far only loses the photo); ⟳ still regenerates over it. Unlike the generated path, the upload pass is **strict**: a file the browser can't decode (HEIC straight off an iPhone, a renamed non-image) fails the upload loudly instead of being stored verbatim — storing it "succeeds" and then shows a broken portrait that no later edit can repair. *Download Image* saves the stored portrait out, **nearest-neighbor upscaled to ≥ `EXPORT_MIN_WIDTH`** by `toExportBlob` — the display copy is a ~192px sliver that only reads as art because every `<img>` renders `image-rendering: pixelated`, and a file has no such CSS, so the upscale is baked into the exported pixels (integer factor: each stored pixel becomes an exact square). Delivery is `lib/download.ts`, three paths in order: on the **APK**, `@capacitor/filesystem` writes the bytes to the app cache and `@capacitor/share` opens the native save/share sheet — the Android System WebView implements neither `navigator.share` nor blob `<a download>`, so this is the only route that reaches the device; then browser **Web Share** with files; then an `<a download>` click on desktop. A dismissed sheet counts as done; any other failure surfaces as a note under the button.
- **Storage:** image blobs in IndexedDB, referenced by key; UI reads via object URLs. Each key also carries a **master copy** under `src:<key>` (`sourceKey`) — the pixels before the downscale + 1-bit pass, bounded to `SOURCE_MAX_SIDE` as JPEG. Masters exist for edit round-trips only; losing one is never fatal (edits fall back to the display copy). A master is only ever kept in a **model-safe format** (`isModelSafeImage`: PNG/JPEG/WebP) — anything else is re-encoded, and when it can't be, **no master is stored at all**. An unconvertible master (HEIC from a phone gallery) posted back as an edit source is rejected by the API *every single time*, which reads as "this uploaded picture can never be edited"; no master at all is strictly better, since the display copy is always canvas-encoded PNG.
- **Diagnostics:** a 200 that carries no image is soft-retried once, then fails with the model's **own text reply** quoted (`extractMessageText`) — a model answering in words is usually saying why ("I can't create images of real people", a policy line), and discarding it leaves the player with a bare badge and nothing to change.
- Fire-and-forget with a visible placeholder while generating; a failed image never blocks the turn.

### Prompt templates — `src/lib/imageTemplates.ts`

Everything that decides *how an image prompt is worded* is one named, switchable
bundle (`ImagePromptTemplate`), picked from a dropdown at the top of **Advanced →
Image Prompts**. It exists because the two backends want different **languages**:
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
- **What's in a template:** the banner style, the four portrait clauses
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
- **What's outside:** `ditherMode`, `locationImages`, `bannerCooldown`,
  `portraitRefImages`, and every ComfyUI connection field. Behaviour and machine
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
  its flat `bannerInstructions` / `portrait*` / `appearanceInstructions` /
  `comfyNegativePrompt` folded onto the *prose* built-in, so an edited style
  clause survives verbatim and the tag dialect simply appears beside it.

### ComfyUI — `src/lib/comfyui.ts`

- **The protocol:** `POST /prompt` with `{ prompt: <graph>, client_id }` → a `prompt_id`; poll `GET /history/<prompt_id>` (which answers with a map *keyed by prompt id* — `{}` means pending) until the entry appears; pull `{filename, subfolder, type}` out of the first output node carrying `images[]` and fetch `GET /view?…` for the bytes. `POST /interrupt` on abort or timeout. Polling rather than the websocket: a socket adds a second failure mode and a `clientId` handshake for a progress bar nothing renders, while history is the authoritative record either way. Unlike SillyTavern's loop this one has a **deadline** (`COMFY_TIMEOUT_MS`) — a phone that walked out of wifi range would otherwise sit on "rendering…" for the rest of the session.
- **The workflow is the player's**, stored as raw ComfyUI **API-format** JSON (what *Save (API Format)* exports) with `%placeholder%` tokens, and substituted by a **string replace on the JSON text with the quotes included** — `replaceAll('"%steps%"', JSON.stringify(25))`. That one mechanism gets the types right for free: `JSON.stringify` supplies the quotes for a string and emits a bare number for a number, so `"steps": "%steps%"` becomes `"steps": 25` while a prompt full of quotes and newlines lands correctly escaped. It also means **a template must wrap every placeholder in quotes, even numeric ones**. Tokens are deliberately SillyTavern's set, spelling included (`prompt · negative_prompt · model · vae · sampler · scheduler · steps · scale · width · height · denoise · clip_skip · seed`), so a workflow written for one works in the other: `scale` is CFG (there is no `%cfg%`) and `clip_skip` goes out negative, as `CLIPSetLastLayer` counts it. Everything a workflow doesn't reference is simply ignored, which is how a LoRA stack or a Flux pipeline is supported without a setting for it.
- **Validated where it's edited.** `validateWorkflow` runs on the *substituted* text — the raw template isn't valid JSON for a hand-written unquoted number — and both the editor and every generation call it, so a bad paste fails on the screen that caused it rather than as a missing portrait forty turns later. A blank stored workflow falls back to the shipped one (the editor would otherwise have nothing to show); a *broken* one is kept, because it's the player's edit and the error is on screen.
- **Sizing:** `comfyWidth`/`comfyHeight` are the base, used verbatim for a banner. A portrait passes the same `aspectRatio: "2:3"` the OpenRouter path sends and is reshaped to that ratio **at the same pixel area**, snapped to multiples of 64 — so switching backends doesn't quietly change how much work a portrait is.
- **Reaching it from the APK** is three separate blockers, and one answer. ComfyUI returns a hard **403** to any request carrying `Sec-Fetch-Site: cross-site` unless started with `--enable-cors-header`; the Capacitor WebView is served from `https://localhost`, so `http://192.168.x.x:8188` is **mixed content**; and Android blocks **cleartext** from targetSdk 28. Requests therefore go through **`CapacitorHttp` on native** and `fetch` on the web — a native request leaves from Java, where none of those three rules apply (the manifest's `usesCleartextTraffic` is patched in CI, since `android/` isn't committed). `server.androidScheme` is deliberately *not* changed: that moves the app's origin and would orphan every installed player's IndexedDB saves. On the web build there is no escape and `--enable-cors-header` is genuinely required, so a 403 is translated into that sentence rather than surfaced as a status — it is the one error every new user hits, and nothing inside the app can fix it. The web POST also sends **no `Content-Type`**, which keeps it a CORS simple request with no preflight; ComfyUI reads the body with `await request.json()` and doesn't check.
- **Discovery:** *Connect* pings `/system_stats` and then reads `/object_info/{KSampler,CheckpointLoaderSimple,UNETLoader,VAELoader}` to fill the checkpoint / sampler / scheduler / VAE pickers (a combo input's options are `input.required.<field>[0]`). Every lookup is optional — a build without `UNETLoader` is normal. This exists because a wrong host and a mistyped checkpoint name fail *identically*, as a portrait that never appears, and neither is visible anywhere else in the app.
- **What ComfyUI does not do:** ✎ **Edit** is OpenRouter-only (`imageEditAllowed`) and the button is hidden, not disabled — feeding an image into a workflow means a *different graph* with a LoadImage node, which is the player's to write and not something the app can substitute into one. **Portrait style reference images** are likewise not sent, for the same reason; the Image Prompts screen says so while the backend is selected. Uploads, downloads, *Remove Image* and the zoom view are unaffected — none of them talks to a model.

---

## Data Model (on-device, TypeScript)

One **active game state**, autosaved continuously; **named save slots** are full snapshots.

```ts
Settings {                    // global, edited in Settings
  openRouterKey, textModelId, imageModelId (default: nano-banana-2-lite), temperature
  imageKey, imagesEnabled                      // Model & Key — the image master switch
  imageBackend: openrouter | comfyui           // Model & Key — which machine draws
  comfyUrl, comfyWorkflow,                     //   ComfySettings (lib/comfyui.ts → DEFAULT_COMFY)
    comfyModel, comfyVae, comfySampler, comfyScheduler,
    comfySteps, comfyScale (CFG), comfyWidth, comfyHeight,
    comfyDenoise, comfyClipSkip
  reasoningLevel: auto | off | minimal | low | medium | high                // Model & Key
  // Advanced (grouped into sub-menus: Narrator · Characters · Images · Image Prompts):
  customInstructions, optionInstructions                                // Narrator
  characterCreationInstructions, characterUpdateInstructions,           // Characters
    standingInstructions, departureInstructions, spotlightRule
  ditherMode, locationImages, bannerCooldown                            // Images
  imageTemplates: ImagePromptTemplate[], imageTemplateId,               // Image Prompts
    portraitRefImages
}

ImagePromptTemplate {         // one image dialect — lib/imageTemplates.ts
  id, name, format: prose | tags
  bannerInstructions
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
  lastBannerTurn?                       // turn a location banner was last GENERATED — cooldown anchor
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
  members, so `PARTY_LIMIT` is the marching order; the **bench is unlimited**
  and holds the stable. A narrator `add` past the cap lands the character
  BENCHED — visible in the Party screen, named in the roll call.
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
- **One portrait per character**, keyed `portrait:<characterId>` and shared
  across adventures, generated from how they look *in the current adventure*.
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
│                                       │  header IS the location banner:
│      location banner (1-bit)          │  double height, art as background,
│ THE DUSTY PATH          Day 37    =   │  label · day · menu along the bottom
│──────────────────────────────────────│  over a fast black gradient
│  narration prose (short, scrolls)     │  message log
│  ...                                  │
│  1. Approach the ruins                │  AI options — in the chat view, under
│  2. Signal the party to hold          │  the latest beat (tap or number key)
│  3. Scan the treeline                 │
│ [KAI] [NAVI] [RILEY] [ELARA]          │  party portrait strip (tap → sheet)
│ [ LOOK ] [ PARTY ] [ INVENTORY ]      │  fixed buttons
│ > _______________________________     │  freeform input
└──────────────────────────────────────┘
```

- **Top bar = the location banner** (when `Settings.locationImages` is on): one
  element, not a header plus a strip below it. The bar doubles to 120px, the
  generated 1-bit image is its background, and the location label, the day and
  the menu button sit along the **bottom** edge, drawn **directly on the art** —
  no scrim, no gradient.
  The gradient that used to back them was darkening the bottom third of every
  banner to make room for two short words; an **outline** buys the same
  legibility for none of the picture (`-webkit-text-stroke: 3px #000` with
  `paint-order: stroke`, so black traces each glyph and the white fill paints on
  top). Tapping bare art opens it full-screen. **No controls sit on the art at
  all**: ✎ followed ⟳ and ▲ off the bar — a location banner is scenery the story
  replaces every time the player moves, so retouching one does not earn a button
  parked permanently on top of it, and each glyph cost the image the corner it
  sat in. (`regenerateBanner` is still in the store, just not surfaced;
  `editBanner` is gone.) Merging them was the point: the
  header and the banner were printing the same location name 60px apart, and
  the banner's height came straight out of the reading area. Everything drawn
  on the art uses literal `#000`/`#fff` rather than the ink/paper tokens — the
  banner is a real bitmap that the invert theme does **not** flip, so a themed
  glyph would go black-on-black the moment the player inverted. With location
  images off the bar is exactly the strip it always was.
- **AI options:** 3–4 contextual choices from the `<<<LOOM>>>` block, rendered **in the chat view, directly under the latest narration beat** and **above the party portrait strip**; number keys submit; each just sends its text as a normal turn. They scroll with the chat, tethered to the beat that produced them.
- **Chat scrolling:** the log opens on the newest beat and follows the tail while the reader is parked there; scrolling up into the history stops the follow and shows a **↓ LATEST** button back to the live edge.
- **Party strip** sits below the options, above the fixed buttons; always visible; tapping a portrait opens that member's **full-screen sheet** (info · edit fields · **regenerate portrait** · **auto-update**). Strip portraits are zoomed 50% and top-aligned so the face fills the tall slot; the sheet's portrait frame is **2:3**.
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
  Screens with internal depth register `setBackHandler` on the store (Advanced's
  sub-menus) rather than taking an `onBack` prop, because a prop can never reach
  the hardware button. The popstate handler re-arms the spare **itself** — a
  handled back may not change `screen` at all, so an effect keyed on `screen`
  would miss it and the next back would exit.
- **Soft keyboard**: `#root` is `100dvh` (with `height: 100%` as the fallback)
  plus `interactive-widget=resizes-content`, so the keyboard shrinks the shell
  instead of pushing the composer off-screen.
- **Touch targets** are `min-h-11` (44px) on `btn`/`btnSmall`, the turn
  controls, the header gear and the banner icons. `btnSmall` — used for Restore
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
  with Model & Key so the two screens can't drift.
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
  ⟳, so an automatic banner or portrait that failed left an eternal placeholder
  and no reason — the cause (no credit, refused prompt, unreadable file) only
  surfaced if the player happened to press ⟳. It now records on both paths.

### Secondary screens
All secondary screens — **member sheet, Party, Inventory, Quests, and every Settings sub-screen** — are **full-screen overlays with a Back button** in a top header (the mobile pattern; no split panes). They open over the chat and return to it on Back. Same store/components regardless.

- **Menu (gear)** → full-screen screens, play-facing first: **Party**, **Inventory**, **Quests**, **World Notes**, **Saves**, then **Characters** (the whole cast), the **Scenario** editor, **Model & Key**, **Cloud Sync**, **Appearance**, **RPG System**, **Advanced instructions**. The first five are also on the ⋯ shortcut beside GO.
- **Cloud Sync screen** is the account and nothing else: email + password, sign in / create account, last-sync line, **Sync Now**, **Sign Out**, and a closed **Supabase Project** section for a player running their own project (blank = the build's own, from `VITE_SUPABASE_*`). No checkboxes for *what* syncs — a half-synced save is worse than none.
- **RPG System screen** owns the dice and nothing else: **Stakes** on/off, the
  dice (`diceCount` × `diceSides`), what Strengths and Flaws are worth, where the
  STRONG/MIXED bands sit, **when to roll** (`alwaysRoll`, or the editable risk-word
  list), the **dice toss** on/off with its **Test Roll** and view controls
  (**Table Pitch** / **Table Yaw** / **Perspective**, shown only when the toss
  is on — `sceneView` clamps the angles inside `MAX_TILT` on read, since past
  45° the neighbouring face would out-face the rolled one), and the **Outcome
  Rule** — with a live preview reading through
  `normalizeDice`, so what it shows is what will be rolled. Its own screen rather
  than a fifth Advanced sub-menu: Advanced is *prompt text handed to a model*,
  and this is mechanics the app resolves on-device before the model sees the turn.
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
    Paper · Paper on Ink · Amber CRT · Green CRT). Generated banner and portrait
    art is a real 1-bit bitmap and stays black and white whatever is picked.
- **Advanced screen** is an **index of sub-menus**, not one scroll: **Narrator**
  (voice + suggested actions), **Characters** (creation · the freeze rule ·
  standings · departures · spotlight), **Images** (1-bit shading · location
  images on/off · location cooldown — behaviour only), **Image Prompts** (the
  template picker and everything a template holds: appearance rule · banner
  style · the four portrait clauses · negative prompt · style references). Every prompt rule the story writes characters by is
  editable there, each with its own Reset; blanking one **drops that line** from the
  protocol rather than falling back to a built-in. The JSON *shape* around them is
  the parser's contract and is never editable. Sub-menu depth is local component
  state — Back pops to the index first, then out of Advanced.
- **Characters screen** lists the global cast grouped by this adventure's standing — PC, then *In Party n/3*, *Benched*, *NPCs & Allies*, *Gone*, and *Everyone Else* — each row opening the sheet and carrying one-tap moves (**Add to Party** / **Bench** / **Kick** / **Make NPC**). **+ New Character** creates someone in the library only. A filter box appears once the cast grows past 8.
- **Party screen** lists the company in two halves — *In the scene n/3* (**Bench** / **Kick**) and *Benched* (**Activate** / **Kick**) — with a route to Characters when both are empty. The member sheet carries the same Kick/Add control, the adventure **standing** (active / benched / npc / departed / fallen) with a one-line explanation of what the current one means, **Revert Story Changes** when the story has diverged, and **Delete Character** (library-wide, player-only).
- **Member sheet order:** portrait → **Image Options** (a closed disclosure: upload · download · remove · the custom portrait prompt) → **Edit** → the sheet → **Story** (Auto-Update, and Revert Story Changes when the story has diverged) → **Condition** → **Standing** → leave/delete. Who the character *is* comes first and everything you can *do* to them follows: the sheet used to open with six buttons and an image-prompt fieldset, so a screen whose entire purpose is the prose underneath them made the player scroll past all of it to reach a name. Nothing was removed — the once-a-character controls fold away, the rest moved below the text they act on.
- **Member sheet fields:** Name · **Species** · **Sex** (both free text — the setting owns the vocabulary) · Appearance · Personality · Drive · Strengths · Flaws · **Notes** · Equipment, then the per-adventure **Condition** and **Standing**. **Notes** is the player's own field — no ✦, and no model writes it. In Edit mode the five *other* prose fields each carry a **✦ generate** button (see *Per-field generation*), and so does every **Equipment** row, beside its Remove (see *Item generation*); ✦ rather than ✨ because the sparkle is an emoji and browsers paint it in colour, which is one colour more than this app has — the same reason the portrait controls are ⟳ and ✎.
- **Style:** two colors only, monospace, square borders, no rounded corners, no gradients. Small token set in `theme.css` (`--ink`, `--paper`, shipped as `#000`/`#fff`) so it stays one system — the pair is the player's (Appearance → Colors), but everything still reads through those two tokens and nothing else.

### Reading area

This is a text game, and its chrome had grown to eat more than half a phone:
header + 16:5 banner + a 1:2 party strip + composer left roughly 350px for
prose, with the action options rendering *inside* that same scroll region so a
fresh beat was often pushed above the fold by its own suggestions. The fixes are
all about handing that space back:

- **`Settings.bannerSize`** — `full` is the double-height top bar (120px),
  `compact` the single-height one (60px) with the art still behind the label
  under a flat scrim. Tapping the art opens it full-screen in either.
- **Party strip** slots are **3:5**, not 1:2 — portraits are face-cropped
  (`origin-top scale-150`), so the extra height never showed more of anyone. A
  party of nobody collapses the four-slot grid to a single row rather than
  standing three full-height dashed boxes on screen. There is **no name caption**
  under a face: four portraits the player picked and generated are already four
  recognisable faces, and the caption was a row of chrome repeating the picture.
  Its height goes back into the portrait (3:4 + caption ≈ 3:5 of face), so the
  reading area keeps what it had while the faces grow; the name still reaches
  assistive tech via `aria-label`, and a tap opens the sheet that spells it out.
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
- **Phase 3 — Images.** `images.ts`; deterministic banner/portrait triggers, IndexedDB blob store, regenerate buttons. Verify OpenRouter image-output shape first.
- **Phase 4 — Authoring + Saves.** Scenario editor, World Notes CRUD + keyword injection, Advanced instructions, save slots (snapshot/restore/new). The pre-made scenario ships as the default.
- **Phase 5 — Polish + APK.** ✅ Reversal (`reversal.ts` pre-turn slice snapshot; `undoLastTurn`/`regenerateLastTurn`; `TurnControls`), error auto-retry (`retry.ts` policy + `streamChat` whole-stream restart, ported from Wayward), APK signing/CI (`android.yml`), mobile polish (overscroll lock, safe-area insets).

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
- **`Settings.historyBudget`** (Advanced → Narrator) — the 3000-token budget was
  hardcoded and never passed by the store. It ships unchanged, but a
  large-context model can now be given far more.
- **`Settings.maxTokens`** — no `max_tokens` was ever sent, so "short and punchy"
  was a sentence in the prompt and nothing else. 0 restores no cap.

### Reasoning level (Model & Key)

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

## Cloud sync — `src/lib/sync.ts` · `syncEngine.ts` · `supabaseClient.ts`

The device *is* the database (IndexedDB + localStorage), which means an
adventure is stuck on the device it started on. Sync mirrors the same documents
into a Supabase project the player owns, so signing in on a second device
resumes the same game. **Opt-in** (`Settings.syncEnabled`, off by default) and
additive: with it off, nothing about the app changes and no request is made —
the SDK is a lazy `import()`, so its ~130 KB is not even in the main bundle.

**The remote shape is deliberately dumb** (`supabase/migrations/`): one
key/value table `loom_docs (user_id, key, doc jsonb, deleted, device,
updated_at)` and one private Storage bucket `loom-images`. The keys are
`active` · `settings` · `slot:<id>`; images are objects at
`<user_id>/<base64url(cache key)>`, encoded because a cache key is free text
("banner:Boars Head Tavern"). Every policy is `auth.uid() = user_id` — the
anon key ships in the app, as it is meant to, and RLS is what protects the data.
`updated_at` is stamped by a trigger, never by the client: it is the merge
clock, and two phones disagree about what time it is.

**Merging is a watermark, not a clock comparison.** Each key carries a
`DocStamp { localAt, syncedAt, remoteAt }` in a new IndexedDB `meta` store —
`localAt > syncedAt` means "changed here since the last sync",
`remote.updated_at !== remoteAt` means "changed there". `planDoc` turns that
into `push | pull | conflict | none`, and it is pure and unit-tested, because a
wrong answer here loses a game. `localAt` is written on every save (inside
`db.ts`/`settings.ts`, not at the ~40 `saveActiveGame` call sites — see
`dirty.ts`) so a game played on a plane still looks changed after a restart.

**Only the active game can ask.** `conflictPolicy` per key: settings take the
**newest**, a save slot is an immutable snapshot so the server's copy stands,
and the active game **asks**
(`SyncConflictModal`, in the story's terms: title · day · turn · location).
Both copies are snapshotted into save slots *before* the question is asked, so
either answer is undoable from Saves and a sync can never destroy a game.
Images never ask — two versions of a portrait are not two stories, so the newer
one wins silently (`planImages`), and a local deletion propagates as a delete
rather than being undone by the other device's copy.

The cast used to be a document of its own with a **merge** policy (a set union).
It has neither now: it rides inside `active`, so it is covered by the one prompt
— which is the only correct answer once the cast is per-adventure, since a union
would quietly refill a New Adventure's empty cast from the other device. The old
`characters` key is **skipped**, not tombstoned (`sync.ts →
LEGACY_CHARACTERS_DOC`): a stamp with nothing local behind it reads as a
deletion, and pushing that would wipe the cast out from under a device still
running the older build.

**Ordering rule:** a stamp is written only after the bytes land. A crash
mid-pass leaves a key looking dirty and costs one redundant transfer; the
opposite order would mark a document synced that never left the device. Passes
are single-flight, debounced 5s after the last write, and re-run when the app
comes back to the foreground — which on a phone is the moment that matters.

**What does not travel:** `supabaseUrl` / `supabaseAnonKey` (this device's way
in — a blank override pushed from one device would lock out the other) and
`comfyUrl` (a LAN address that means a different machine elsewhere). The
OpenRouter key *does*, by choice, so a new device is playable the moment it
signs in. Added web fonts are re-added per device — the `webFonts` list syncs,
the woff2 files do not.

---

## Verification

- **Unit tests (vitest)** on the pure ports — the highest-value safety net, mirroring Wayward's test targets:
  - `spotlight.ts`: `_member_spoke` / `detectSpeakers` (name-mention vs actual dialogue), signal computation, group-address detection.
  - `prompt.ts`: block ordering, history trimming to budget, opening-narration prepend.
  - `<<<LOOM>>>` parser: tolerant salvage, block always stripped from prose, options parse.
- **Manual end-to-end on device/emulator:** start the pre-made scenario → take several turns → confirm short punchy narration, working options + fixed buttons, banner appears on new location, portraits appear for party, spotlight voices addressed members and stays quiet otherwise, save/load round-trips, everything editable in Settings.
- **APK smoke test:** install the CI artifact, run a full turn with a real OpenRouter key.

---

## Open items to confirm during build (not blocking)
- Exact OpenRouter **image-output** request/response shape for Nano Banana 2 Lite (verify against live docs).
- Default **text model** to ship in Settings (uncensored/roleplay-tuned; user picks their own key anyway).
- Whether the single active-game + snapshot-slots model (chosen here for simplicity) is preferred over a Wayward-style world/adventure split.
