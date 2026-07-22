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
  "party": [ { "op":"add", "name":"Riley", "species":"human", "description":"...", "fieldSkill": {"name":"...","description":"..."} } ],
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
- **Reversal** (swipe/regenerate): record the applied deltas on the message, unwind on redo — same shape as Wayward's `_reverse_message_effects`, minus item instances.

---

## Ported from Wayward (TypeScript)

### 1. Spotlight — `src/lib/spotlight.ts` (near-verbatim port of `server/ai/spotlight.py`)
The single most valuable carry-over. Port faithfully:
- `STOPWORDS`, `GROUP_ADDRESS_RE`, `_SAID_VERBS`, `_name_pattern`, `_member_spoke`.
- `computeSpotlightSignals(playerMsg, recentContext, party, currentTurn)` → `{directlyAddressed, fieldSkillRelevant, turnsSinceLastSpoke}`.
- `formatSpotlightBlock(signals, rule)` → the `PARTY SPOTLIGHT — THIS TURN` block.
- `detectSpeakers(responseText, party)` → ids that actually got a line, to bump `lastSpokeTurn`.
- Keep the rule text (`DEFAULT_SPOTLIGHT_RULE`) editable in Settings.
- **Same dialogue convention** (`Name: "…"`) drives both the client display segmenter and speaker detection — one convention, wired once.

### 2. Prompt assembly — `src/lib/prompt.ts` (trimmed port of `prompt_builder.py::build_prompt`)
One isolated function returning the OpenRouter `messages[]`, in order:
1. **Core narrator instructions** (Loom role: short punchy second-person shonen adventure, uncensored, sandbox) + player **custom instructions** appended.
2. **Scenario / premise** (the editable pre-made scenario).
3. **PC summary** + equipment text fields.
4. **Party roster** — description, personality/likes/dislikes, Field Skill, equipment (port `_format_equipment`, simplified to `{label, description}` — no catalog lookup).
5. **Inventory** (compact `label ×qty — description` list).
6. **Active quests** (compact `label — description (reward: …)` list; done quests omitted).
7. **World Notes** matched by keyword (single-category, simplified `match_entries`; titles are implicit keywords; scan the new message + last few turns).
8. **Spotlight block** (from `spotlight.ts`).
9. **Chat history** window (trim to a token budget; prepend the opening narration as the first assistant turn — port `_trim_to_budget`). *History summarization is deferred* — messages stay short, so a rolling window suffices for MVP.
10. **Output-protocol instruction** — how to emit prose + the `<<<LOOM>>>` block, and the `option` instruction (player-editable).
11. **Player's new message.**

---

## Image Generation — `src/lib/images.ts`

- **Access:** OpenRouter chat-completions with an image-output model (Nano Banana 2 Lite), reading the returned image (base64 data URL) from the response. *(Exact request/response shape for image output over OpenRouter must be verified against current OpenRouter docs at implementation time — flag, don't assume.)*
- **Two kinds, deterministic triggers (not model-driven):**
  - **Location banner** — keyed by `banner:<location>`. On a scene change to an **uncached** location, generate from location name + a short narration excerpt + the **banner style instructions**.
  - **Party portrait** — keyed by `portrait:<memberId>`. When a member has no portrait, generate from their description + the **portrait style instructions**.
- **Style baked in:** default banner/portrait instructions enforce **1-bit monochrome pixel/line art**. Player-editable under Advanced.
- **Regenerate:** a button on the banner and on each party sheet re-runs generation and replaces the cached blob.
- **Storage:** image blobs in IndexedDB, referenced by key; UI reads via object URLs.
- Fire-and-forget with a visible placeholder while generating; a failed image never blocks the turn.

---

## Data Model (on-device, TypeScript)

One **active game state**, autosaved continuously; **named save slots** are full snapshots.

```ts
Settings {                    // global, edited in Settings
  openRouterKey, textModelId, imageModelId (default: nano-banana-2-lite), temperature
  // Advanced:
  customInstructions, bannerInstructions, portraitInstructions, optionInstructions, spotlightRule
}

GameState {                   // the active game (autosaved) + what each save slot stores
  scenario: { title, premise, openingNarration, startDay }   // the editable pre-made scenario
  characters: Character[]     // PC (role:'pc') + party (role:'member')
  worldNotes: Note[]          // { id, title, keywords[], content }  — single-category lorebook
  inventory: Item[]           // { label, description, quantity }  — shared party inventory
  quests: Quest[]             // { id, label, description, reward, status }
  messages: Message[]         // { role, content, turn, appliedDeltas, day, location, weather }
  turnNumber, day, location, weather
}

Character {
  id, role, name, species, description, personality, drive, likes, dislikes,
  fieldSkill: { name, description },
  equipment: { label, description }[],   // simple text fields, no catalog
  portraitKey?, lastSpokeTurn, inParty
}
```

- **No world/adventure split.** Editing anything in Settings/panels edits the active game (matches "edit everything, no Edit mode"). "New Adventure" seeds a fresh game from the editable scenario + roster; "Save"/"Load" snapshot/restore slots.
- **Field Skill** carries Wayward's writing guidance as a placeholder in the editor (teaches the format).

---

## UI — single column, mobile-first, 1-bit

Layout top-to-bottom (the reference screenshot is a **style guide, not literal truth**):

```
┌──────────────────────────────────────┐
│ THE DUSTY PATH               Day 37   │  header: location · day
│ ┌──────────────────────────────────┐ │
│ │        location banner (1-bit)    │ │  generated banner
│ └──────────────────────────────────┘ │
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

- **AI options:** 3–4 contextual choices from the `<<<LOOM>>>` block, rendered **in the chat view, directly under the latest narration beat** and **above the party portrait strip**; number keys submit; each just sends its text as a normal turn. They scroll with the chat, tethered to the beat that produced them.
- **Party strip** sits below the options, above the fixed buttons; always visible; tapping a portrait opens that member's **full-screen sheet** (info · edit fields · **regenerate portrait**).
- **Fixed buttons:** `LOOK` sends "I look around."; `PARTY` and `INVENTORY` open full-screen views. (LOOK is a narrative action; PARTY/INVENTORY are views.)
- **Inventory view:** a list of `Label · Description · Quantity` rows, editable inline.
- **Quests view:** a list of `Label · Description · Reward` rows (+ active/done status), editable inline; reached from the menu/header (kept off the 3-button row to preserve the screenshot's layout).

### Secondary screens
All secondary screens — **member sheet, Party, Inventory, Quests, and every Settings sub-screen** — are **full-screen overlays with a Back button** in a top header (the mobile pattern; no split panes). They open over the chat and return to it on Back. Same store/components regardless.

- **Menu (gear)** → full-screen screens: **Quests**, **Scenario** editor, **Characters** (PC + party CRUD), **World Notes**, **Model & Key**, **Advanced instructions**, **Saves**.
- **Style:** pure black/white, monospace, square borders, no rounded corners, no color. Small token set in `theme.css` (`--ink #000`, `--paper #fff`) so it stays one system.

---

## Build Phases

- **Phase 0 — Scaffold.** Vite + React + TS + Tailwind + Zustand + `idb` + Capacitor. 1-bit `theme.css`. This design doc. GitHub Actions APK build (learn from Wayward's `android.yml`; signed release, self-update-friendly).
- **Phase 1 — Core loop.** Settings (key + model). `prompt.ts` + streaming call + `<<<LOOM>>>` parse + truncate-at-`<<<`. Narration renders; options work; day/location/weather apply; autosave. (PC only, no party, no images yet.)
- **Phase 2 — Party + Spotlight.** Port `spotlight.ts`; party roster, portrait strip, member sheets, inventory view, fixed buttons, `detectSpeakers` → `lastSpokeTurn`. Dialogue segmenter (`Name: "…"`).
- **Phase 3 — Images.** `images.ts`; deterministic banner/portrait triggers, IndexedDB blob store, regenerate buttons. Verify OpenRouter image-output shape first.
- **Phase 4 — Authoring + Saves.** Scenario editor, World Notes CRUD + keyword injection, Advanced instructions, save slots (snapshot/restore/new). The pre-made scenario ships as the default.
- **Phase 5 — Polish + APK.** Reversal (swipe/regenerate), error auto-retry (port the idea from Wayward), APK signing/CI, mobile polish.

*Deferred (not MVP):* history summarization, NPC/item art, TTS, weather animation, multi-world.

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
