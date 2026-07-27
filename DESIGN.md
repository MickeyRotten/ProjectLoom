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
- Carry over: **Spotlight**, **day counter**. Single-category lorebook = **World Notes**. Equipment = simple `{label, description}` text fields per character.
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
- `party` ops match **by name across the whole character library**, so a companion from an earlier adventure is re-used, not duplicated. **A sheet is authored once, at creation, and frozen after**: only an `add` naming someone genuinely new writes `species`/`description`/`personality`/`drive`/`strengths`/`flaws` **and their starting `equipment`** (straight onto the new `Character`) — the narrator kits a companion out from the appearance it just wrote, and the gear is the player's from then on. Every later op — `add` or `update` — carries `standing` and nothing else; sheet fields on a character who already exists are dropped. An `add`/`update` may carry `"standing": "active" | "benched" | "npc"`, and a `remove` `"standing": "departed" | "fallen"` — nothing the model emits ever deletes anyone. See *Characters ⟂ Party*.
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
  `turn|action` per die, mod `diceSides` + 1 — **pure in (turn, action text,
  rules)**. `regenerateLastTurn` re-sends the same input on the same turn, so a
  random roll would let the player re-roll until the answer was "strong";
  seeding means a regenerate re-*tells* the same result, and editing the action
  — genuinely choosing something else — earns a new roll. The **first die keeps
  the original single-die seed**, so a roll made before the dice were
  configurable still replays to the number it was recorded with. Each extra die
  is hashed separately (`turn|action|i`) rather than sliced out of one hash, so
  2d6 has a real 2d6 distribution.
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
  an opaque full-screen layer — real CSS 3D cubes, tumbling, landing on the faces
  the turn actually rolled — holds the result, and fades out. Staged in `sendTurn`
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
9. **Chat history** window (trim to a token budget; prepend the opening narration as the first assistant turn — port `_trim_to_budget`). *History summarization is deferred* — messages stay short, so a rolling window suffices for MVP.
10. **Active-party roll call** (`formatPartyComposition`) — the *authoritative* composition, re-read from the roster **every turn** and placed **after** the history on purpose: history outlives membership, so the last thing the model reads before the action is who is actually here. Names the `active` members `n/PARTY_LIMIT`, the `benched` ones under an explicit "NOT in this scene", the most recent departures with their `standing` (`partedMembers`) so the narrator stops writing them in — and never resurrects a `fallen` one — and every `npc` by name, so an ally is never forgotten between the turns that reach them. **Always emitted, even for an empty party** ("the player is ALONE") — the empty case is exactly where the history drifts.
11. **Output-protocol instruction** — how to emit prose + the `<<<LOOM>>>` block, and the `option` instruction (player-editable).
12. **Player's new message.**

---

## Image Generation — `src/lib/images.ts`

- **Access:** OpenRouter chat-completions with an image-output model (Nano Banana 2 Lite), reading the returned image (base64 data URL) from the response. *(Exact request/response shape for image output over OpenRouter must be verified against current OpenRouter docs at implementation time — flag, don't assume.)*
- **Two kinds, deterministic triggers (not model-driven):**
  - **Location banner** — keyed by `banner:<location>`. On a scene change to an **uncached** location, generate from location name + a short narration excerpt + the **banner style instructions**. Gated by `Settings.locationImages`, see below.
  - **Party portrait** — keyed by `portrait:<memberId>`. When a member has no portrait, generate from their name/species/**sex**/description + the **portrait style instructions** — *unless* the player removed it (`Character.noPortrait`), see **Remove** below. Sex is in the Subject because an image model given only prose guesses, and guesses differently on every regenerate.
- **Style baked in:** default banner/portrait instructions enforce **1-bit monochrome pixel/line art**. Player-editable under Advanced.
- **Location images off by default (Advanced → Images → `Settings.locationImages`):** the whole banner feature is opt-in. Portraits are drawn once per character and then reused forever; a location banner is a fresh generation every time the story moves somewhere new, which makes it the app's most expensive habit and the one furthest from the text the player came for. Off means **no generation and no UI**: `syncImages` skips the banner entirely (cached or not), `regenerateBanner` / `editBanner` no-op, `<Header>` falls back to the plain single-height ink strip (no art, no image controls), and the Menu's *Compact Location Image* toggle and the Advanced cooldown + banner-style fields are hidden rather than left as dead controls. Nothing is deleted — already-generated banners are still in IndexedDB and reappear the moment it's switched back on. Portraits are unaffected.
- **Location image cooldown (Advanced → `Settings.bannerCooldown`, 0 = off):** turns to skip automatic banner generation for after one is drawn — `3` means the next 3 turns draw no new location image, the 4th does (`bannerOnCooldown` / `bannerCooldownLeft`, counted from `GameState.lastBannerTurn`). A location-hopping stretch otherwise bills one generation per turn, which is the single easiest way to burn image credit without noticing. Three deliberate limits: the gate is on **generation only**, so an already-cached location still shows its banner instantly; the stamp is written on a real generation only, never a cache hit, so re-treading known ground doesn't stall the next new one; and **`regenerateBanner` ignores the cooldown** (but restarts it — it *is* a generation; no longer reachable from the bar, see *Top bar*). While suppressed the banner placeholder says how many turns are left, so it never reads as a broken image. `lastBannerTurn` is deliberately outside `Reversal` — an undo can't un-spend a generation.
- **Regenerate:** ⟳ on each member sheet (and `regenerateBanner` in the store) re-runs generation and **replaces the cached blob and its master** — generated, edited, or uploaded, whatever is there loses. A forced regeneration that fails flags `imgError` (an *image failed* badge) **with the reason** — "failed" alone is unactionable, and the causes are wildly different (no credit, a refused prompt, an unreadable file). ⟳ also clears `noPortrait`.
- **Edit (✎):** instruction + the image back to the model; the result **becomes** the new image (display copy *and* master). The edit source is the master, never the display copy — handing a model a 192px 1-bit thumbnail comes back as mush or as a text-only reply that fails the edit outright.
- **Remove (member sheet):** *Remove Image* deletes a member's portrait **and its master**, revokes the object URL, and sets `Character.noPortrait` on the global character. The flag is the whole point: the automatic trigger is "no cached portrait → draw one", so without it the next turn's `syncImages` would silently undo the removal. It's a character-level choice (a portrait is shared across adventures), and only ⟳ or an upload clears it.
- **Upload / download (member sheet):** *Upload Image* replaces a member's portrait with a file from the device — put through the same downscale + 1-bit pass as a generated portrait, so custom art lands in the same visual system and stays small in IndexedDB (with shading **off** it keeps `UPLOAD_PLAIN_WIDTH` instead of the 1-bit pixel width: no pixel grid to snap to, so crushing it that far only loses the photo); ⟳ still regenerates over it. Unlike the generated path, the upload pass is **strict**: a file the browser can't decode (HEIC straight off an iPhone, a renamed non-image) fails the upload loudly instead of being stored verbatim — storing it "succeeds" and then shows a broken portrait that no later edit can repair. *Download Image* saves the stored portrait out, **nearest-neighbor upscaled to ≥ `EXPORT_MIN_WIDTH`** by `toExportBlob` — the display copy is a ~192px sliver that only reads as art because every `<img>` renders `image-rendering: pixelated`, and a file has no such CSS, so the upscale is baked into the exported pixels (integer factor: each stored pixel becomes an exact square). Delivery is `lib/download.ts`, three paths in order: on the **APK**, `@capacitor/filesystem` writes the bytes to the app cache and `@capacitor/share` opens the native save/share sheet — the Android System WebView implements neither `navigator.share` nor blob `<a download>`, so this is the only route that reaches the device; then browser **Web Share** with files; then an `<a download>` click on desktop. A dismissed sheet counts as done; any other failure surfaces as a note under the button.
- **Storage:** image blobs in IndexedDB, referenced by key; UI reads via object URLs. Each key also carries a **master copy** under `src:<key>` (`sourceKey`) — the pixels before the downscale + 1-bit pass, bounded to `SOURCE_MAX_SIDE` as JPEG. Masters exist for edit round-trips only; losing one is never fatal (edits fall back to the display copy). A master is only ever kept in a **model-safe format** (`isModelSafeImage`: PNG/JPEG/WebP) — anything else is re-encoded, and when it can't be, **no master is stored at all**. An unconvertible master (HEIC from a phone gallery) posted back as an edit source is rejected by the API *every single time*, which reads as "this uploaded picture can never be edited"; no master at all is strictly better, since the display copy is always canvas-encoded PNG.
- **Diagnostics:** a 200 that carries no image is soft-retried once, then fails with the model's **own text reply** quoted (`extractMessageText`) — a model answering in words is usually saying why ("I can't create images of real people", a policy line), and discarding it leaves the player with a bare badge and nothing to change.
- Fire-and-forget with a visible placeholder while generating; a failed image never blocks the turn.

---

## Data Model (on-device, TypeScript)

One **active game state**, autosaved continuously; **named save slots** are full snapshots.

```ts
Settings {                    // global, edited in Settings
  openRouterKey, textModelId, imageModelId (default: nano-banana-2-lite), temperature
  reasoningLevel: auto | off | minimal | low | medium | high                // Model & Key
  // Advanced (grouped into sub-menus: Narrator · Characters · Images · Portraits):
  customInstructions, optionInstructions                                // Narrator
  appearanceInstructions, characterCreationInstructions,                // Characters
    characterUpdateInstructions, standingInstructions,
    departureInstructions, spotlightRule
  ditherMode, locationImages, bannerCooldown, bannerInstructions        // Images
  portraitAction/Context/Composition/Style, portraitRefImages,          // Portraits
    portraitRefInstruction
  // RPG System (its own screen — mechanics, not prompt text):
  stakesEnabled, stakesRule, riskKeywords, alwaysRoll, diceAnimation,
  diceCount, diceSides, strengthsBonus, flawsPenalty,                   // DiceRules
    strongThreshold, mixedThreshold
}

Character[]                   // GLOBAL cast library — outlives every adventure
Character {
  id, role, name, species, sex, description, personality, drive,
  strengths, flaws,                      // free text, one field each
                                         // sex is free text too — pronouns for the narrator,
                                         // a Subject line for the portrait prompt
  notes,                                 // THE PLAYER'S field — read by the narrator, written by nobody else
  equipment: { label, description }[],   // simple text fields, no catalog
                                         // written once by the creating `add`, player's after that
  useCustomPortraitPrompt?, customPortraitPrompt?
}

GameState {                   // the active adventure (autosaved) + what each save slot stores
  scenario: { title, premise, openingNarration, startDay }   // the editable pre-made scenario
  roster: RosterEntry[]       // per-adventure character state (SPARSE — absent = defaults)
  worldNotes: Note[]          // { id, title, keywords[], content }  — single-category lorebook
  inventory: Item[]           // { label, description, quantity }  — shared party inventory
  quests: Quest[]             // { id, label, description, reward, status }
  messages: Message[]         // { role, content, turn, appliedDeltas, day, location, weather }
  turnNumber, day, location, weather
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
  one line. NPCs carry over into a **New Adventure** — an ally is a fact about
  the setting, not about one run.
- **Kick ≠ leaving the story.** Kick sets `none`: out of the party, still in
  Characters with portrait and sheet, and the narrator is told nothing about it.
  `departed` / `fallen` are story outcomes the player or the narrator sets, and
  only those reach the "no longer travelling" line.

- **Characters are global.** The model creates a character there first, and the
  player adds them to the Party from there. **"New Adventure" preserves the whole
  cast and empties the Party** (only `npc` standings carry over); a companion written in one
  adventure can be recruited into the next with their portrait and sheet intact.
  Save slots snapshot the *adventure*, never the cast, so restoring an old slot
  can't delete a character authored since. A slot naming a since-deleted
  character degrades to a smaller party rather than breaking.
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
  the menu button sit along the **bottom** over a black gradient that reaches
  full alpha within ~16px — the text stays legible over any image without a
  soft ramp greying out the whole picture. **✎ alone** sits top-right over the
  art; tapping bare art opens it full-screen. Regenerate (⟳) and collapse (▲)
  were removed from the bar — sizing lives in Menu → *Compact Location Image*,
  and a redraw is a spend nobody was asking for from a button parked on top of
  the picture; ✎ stays because it is the one control with no equivalent
  elsewhere. (`regenerateBanner` is still in the store, just not surfaced.) Merging them was the point: the
  header and the banner were printing the same location name 60px apart, and
  the banner's height came straight out of the reading area. Everything drawn
  on the art uses literal `#000`/`#fff` rather than the ink/paper tokens — the
  banner is a real bitmap that the invert theme does **not** flip, so a themed
  glyph would go black-on-black the moment the player inverted. With location
  images off the bar is exactly the strip it always was.
- **AI options:** 3–4 contextual choices from the `<<<LOOM>>>` block, rendered **in the chat view, directly under the latest narration beat** and **above the party portrait strip**; number keys submit; each just sends its text as a normal turn. They scroll with the chat, tethered to the beat that produced them.
- **Chat scrolling:** the log opens on the newest beat and follows the tail while the reader is parked there; scrolling up into the history stops the follow and shows a **↓ LATEST** button back to the live edge.
- **Party strip** sits below the options, above the fixed buttons; always visible; tapping a portrait opens that member's **full-screen sheet** (info · edit fields · **regenerate portrait** · **auto-update**). Strip portraits are zoomed 50% and top-aligned so the face fills the tall slot; the sheet's portrait frame is **2:3**.
- **Fixed buttons:** `LOOK` sends "I look around."; `PARTY` and `INVENTORY` open full-screen views. (LOOK is a narrative action; PARTY/INVENTORY are views.)
- **Inventory view:** a list of `Label · Description · Quantity` rows, editable inline.
- **Quests view:** a list of `Label · Description · Reward` rows (+ active/done status), editable inline; reached from the menu/header (kept off the 3-button row to preserve the screenshot's layout).

### Character sheet auto-update — `src/lib/autoUpdate.ts`
The member sheet's **Auto-Update** button opens a modal to check which fields the model may rewrite, then runs **one non-streamed side call** (`completeChat`, tighter temperature than narration) that must answer with a single JSON object. Only three fields are ever writable:

- **Appearance** (`description`) — physical characteristics are **preserved verbatim**; only what the character wears/carries is rewritten, read off their **Equipment** labels + descriptions. Since `description` is the portrait Subject, the sheet's ⟳ picks up the new outfit.
- **Personality** / **Drive** — re-read from the latest `MENTION_SCAN_LIMIT` beats whose text **mentions the character by name** (word-boundary match, same machinery as World Notes).
- **Strengths**, **Flaws** and **Equipment** are never touched — the player owns them, and equipment is what Appearance reads *from*.

Parsing is tolerant like the `<<<LOOM>>>` block (fences/preamble/trailing commas survive) but strict about content: unrequested keys, non-strings, and blanks are dropped, so a bad reply narrows to "fewer fields updated" and never blanks a sheet. Gated behind read mode (an open edit draft would clobber the result) and blocked mid-turn.

### Per-field generation — `src/lib/generateField.ts`

Auto-Update's sibling, and the difference is **where it reads from**. Auto-Update re-reads a character off the **story so far**, so it is a story change. This is **authoring**: a ✦ button beside **Appearance · Personality · Drive · Strengths · Flaws** opens a modal that writes that one field from the character's own sheet — **Species and Sex above all** — the scenario, and the World Notes those words trigger (`worldNotes.ts → matchWorldNotes`, the same keyword matcher, scanned over the sheet instead of the beats). It never reads the beats: a character who hasn't appeared yet is exactly who this is for.

- **One field per call.** Only the requested field's rule is sent, so the model is never told about a field it must not write. Appearance's rule *is* `Settings.appearanceInstructions` — the same sentence the narrator gets — so "Appearance" means one thing app-wide.
- **Preview, then accept.** The modal shows what came back with **Use This / Generate Again / Cancel**, at a looser temperature than a sheet update (authoring wants variety; a re-roll should differ). An optional guidance box rides last in the prompt, so it outranks the sheet it may deliberately contradict.
- **✦ only in Edit mode.** An accepted generation lands in the sheet's **edit draft**, not the character — so **Discard Changes is the undo** and **Save Changes** is what commits it (through `updateCharacter`, which retires that field's story override). The generation reads the draft too, so a Flaws written right after the player typed a Personality reads that Personality.
- The store action writes nothing and takes the character **by value**; it needs no `streaming` guard for that reason, only single-flight.

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
- **One navigation model.** Party / Inventory / Quests / World Notes are in the
  gear menu as well as the ⋯ shortcut. They used to live *only* behind ⋯, so the
  one thing that looks like navigation pointed at half the app.
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

- **Menu (gear)** → full-screen screens: **Quests**, **Scenario** editor, **Characters** (the whole cast), **World Notes**, **Model & Key**, **Appearance**, **RPG System**, **Advanced instructions**, **Saves**.
- **RPG System screen** owns the dice and nothing else: **Stakes** on/off, the
  dice (`diceCount` × `diceSides`), what Strengths and Flaws are worth, where the
  STRONG/MIXED bands sit, **when to roll** (`alwaysRoll`, or the editable risk-word
  list), the **dice toss** on/off, and the **Outcome Rule** — with a live preview reading through
  `normalizeDice`, so what it shows is what will be rolled. Its own screen rather
  than a fifth Advanced sub-menu: Advanced is *prompt text handed to a model*,
  and this is mechanics the app resolves on-device before the model sees the turn.
- **Appearance screen** holds everything that changes how Loom *looks* and
  nothing that changes how it plays: **Text Size**, **Font**, **Invert Colors**.
  The first and last used to sit loose under the nine menu entries — controls
  parked below a navigation list, reachable only by scrolling past it. **Font**
  (`Settings.font`: `system` · `VT323` · `Jersey 15`) repoints the single
  `--font-mono` token through a `data-font` attribute on `<html>`, the same
  one-attribute mechanism as the theme swap, so no component knows about it.
  Both display faces are **bundled** (`src/fonts/`, SIL OFL) rather than linked
  from Google Fonts — the packaged APK plays offline, where a webfont over the
  network simply never arrives — and each carries a `size-adjust` so a Text Size
  setting means the same thing whichever font is picked. An unrecognised stored
  value falls back to `system` (`settings.ts → fontTheme`).
- **Advanced screen** is an **index of sub-menus**, not one scroll: **Narrator**
  (voice + suggested actions), **Characters** (appearance · creation · the freeze
  rule · standings · departures · spotlight), **Images** (1-bit shading · location
  images on/off · location cooldown · banner style), **Portraits** (the Action/Context/Composition/Style
  clauses + style references). Every prompt rule the story writes characters by is
  editable there, each with its own Reset; blanking one **drops that line** from the
  protocol rather than falling back to a built-in. The JSON *shape* around them is
  the parser's contract and is never editable. Sub-menu depth is local component
  state — Back pops to the index first, then out of Advanced.
- **Characters screen** lists the global cast grouped by this adventure's standing — PC, then *In Party n/3*, *Benched*, *NPCs & Allies*, *Gone*, and *Everyone Else* — each row opening the sheet and carrying one-tap moves (**Add to Party** / **Bench** / **Kick** / **Make NPC**). **+ New Character** creates someone in the library only. A filter box appears once the cast grows past 8.
- **Party screen** lists the company in two halves — *In the scene n/3* (**Bench** / **Kick**) and *Benched* (**Activate** / **Kick**) — with a route to Characters when both are empty. The member sheet carries the same Kick/Add control, the adventure **standing** (active / benched / npc / departed / fallen) with a one-line explanation of what the current one means, **Revert Story Changes** when the story has diverged, and **Delete Character** (library-wide, player-only).
- **Member sheet fields:** Name · **Species** · **Sex** (both free text — the setting owns the vocabulary) · Portrait Prompt · Appearance · Personality · Drive · Strengths · Flaws · **Notes** · Equipment, then the per-adventure **Condition** and **Standing**. **Notes** is the player's own field — no ✦, and no model writes it. In Edit mode the five *other* prose fields each carry a **✦ generate** button (see *Per-field generation*); ✦ rather than ✨ because the sparkle is an emoji and browsers paint it in colour, which is one colour more than this app has — the same reason the portrait controls are ⟳ and ✎.
- **Style:** pure black/white, monospace, square borders, no rounded corners, no color. Small token set in `theme.css` (`--ink #000`, `--paper #fff`) so it stays one system.

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
- **`Settings.textScale`** (S/M/L/XL, Appearance) scales narration **only** — chrome
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

*Still deferred:* rolling LLM summarization. The narrator's own notes cover the
same ground while staying inspectable; revisit only if they prove insufficient.

---

*Deferred (not MVP):* NPC/item art, TTS, weather animation, multi-world.

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
