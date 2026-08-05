---
name: loom-turn-protocol
description: >
  The <<<LOOM>>> single-call turn contract for Project Loom — the shape the
  narrator model must emit, how the client streams/parses it, and how state
  deltas are applied and reversed. Use when touching the turn loop, the
  narration stream, the response parser, action options, or swipe/regenerate
  reversal. Read before editing prompt output format or the <<<LOOM>>> block.
---

One player action = one OpenRouter chat completion (streamed). No on-device tool loop. Model emits narration prose, then ONE machine-read JSON block.

## Wire shape

```
<narration prose — short, punchy>

<<<LOOM>>>
{
  "location": "The Dusty Path",
  "weather": "windy",
  "day": 37,
  "options": ["Approach the ruins", "Signal the party to hold", "Scan the treeline"],
  "party":     [ { "op": "add", "name": "Riley", "species": "human", "description": "...", "personality": "...", "drive": "...", "strengths": "...", "flaws": "...", "equipment": [ { "label": "...", "description": "..." } ] } ],
  "inventory": [ { "op": "add", "label": "Cracked Compass", "description": "...", "quantity": 1 } ],
  "quests":    [ { "op": "add", "label": "Reach the Old Settlement", "description": "...", "reward": "..." } ],
  "spoke": ["Navi"]
}
<<<END>>>
```

All block fields optional except when state changed. `op`: `add` | `update` | `remove`.
A party `add` for a NEW name MUST carry `personality`, `drive`, `strengths`, `flaws` and `equipment` (the gear implied by the appearance it just wrote) — the output protocol demands them so a new member never lands blank or empty-handed. That `add` is the ONLY op that writes a sheet: once a character exists, `species`/`description`/`personality`/`drive`/`strengths`/`flaws`/`equipment` are frozen and dropped from every later op — gear is the player's to curate.
A party `add`/`update` MAY carry `"standing": "active" | "benched" | "npc"` (default `active` on add); a `remove` MAY carry `"standing": "departed" | "fallen"` (default `departed`). Pre-rename blocks spell that last one `"status"` — still read, because reversal replays old blocks.
A party `add`/`update` MAY also carry `"newName"` — a RENAME of whoever `name` resolves to. `standing` and `newName` are the only two things a post-creation op can move.

## Party ops span two stores

Characters are GLOBAL (`Character[]`, outlives every adventure); party membership is per-adventure (`GameState.roster`). `applyDeltas(game, characters, block)` returns both halves; `lib/roster.ts` is the only place they join.

- Match `name` (slugged) against the WHOLE character library, `role === "member"` — that's what re-uses a companion from an earlier adventure instead of duplicating them. The PC is never matched. Go through `names.ts → findByName`/`nameForms`, never a hand-rolled `slug(c.name) === key`: a renamed character answers to their FORMER names too, and the history the model is reading still uses them.
- `newName` renames in place (`names.ts → withRename`): the id, the roster entry and `portrait:<id>` are untouched, the old name moves to `Character.aliases`. Refused when the new name already resolves to somebody ELSE (that op is a merge, and merging is the player's call), and ignored on the op that CREATES a character and on `remove`.
- `add` on a KNOWN character: seat them at the requested `standing` and NOTHING else — their sheet is already authored, so every field in the delta is ignored. `add` on an unknown name: create a `Character` in the library, fields → the character itself. This is the only write.
- `update`: a `standing` move, nothing more. Never creates, never writes a sheet field, never writes `overrides` (only `autoUpdate.ts` does that now).
- `remove`: `standing` becomes `departed`/`fallen`. NEVER deletes, and never leaves them in a party seat.
- Only `active` is capped. An `active` join past `PARTY_LIMIT` lands **`benched`** — never a state the UI and the prompt can't show (the old `inParty: false, status: "active"` pair was exactly that).
- A `fallen` entry rejects narrator `add` outright — only the player can bring them back.

## Client contract (invariants)

- **Stream display truncates at first `<<<`** — JSON never flashes mid-stream.
- **Parse tolerant**: brace-matched salvage; ALWAYS strip the block from displayed prose even if JSON malformed (bad JSON must never leak into chat).
- **Options** = the AI action buttons, inline in the same call. Render under the latest beat, above the party strip. Number keys submit.
- **Emit is canonical, read is lenient.** `LOOM_OPEN` is still the one marker the prompt asks for; `parseLoomResponse` additionally accepts marker VARIANTS (`<<LOOM>>`, `<LOOM>`, `[LOOM]`, spacing, case, trailing colon — each only when an object follows, so `[loom]` in prose can't truncate a beat) and, with no marker at all, the last brace-balanced object in the tail whose keys intersect the contract. That last path also strips it from the prose: with no `<<<` anywhere, nothing cut the beat and the raw JSON was rendered as narration.
- **`options` is normalized on parse** (`normalizeOptions`) — `string[]` was claimed by the type and checked nowhere, and an array of objects reaching an option button is a React child that throws. Coerces a single newline/`|`-separated string, `{ text|label|action|… }` rows, a `{"1": …}` map, self-numbering, wrapping bold/quotes; dedupes, caps at `MAX_OPTIONS`. Alias keys (`actions`, `choices`, `suggestions`, `next_actions`, …) are read and deleted. Also applied where a RECORDED block is replayed into the UI, since old saves predate the check.
- **Prose salvage is the second exception to "no state from prose"** (`extractProseOptions`, alongside speaker detection): a trailing run of ≥2 short list lines becomes the options and is REMOVED from the beat. Narrow by construction — tail only, contiguous, short lines — and it fixes three things at once, since a list left in the prose is also in the history the model reads back as an example of what a beat looks like.
- **One repair call, and only for a turn with nothing usable** (`needsBlockRepair` + `prompt.ts → buildRepairMessages`, `Settings.repairBlock`, on by default). Fires when NO block parsed, or when the block carries no options — after every salvage path above, so a compliant model never pays for it. Sends the turn's own messages + the response it gave + "the beat is accepted, emit the block". Runs BEFORE anything is applied, so a repaired block takes the normal `reconcileBlock` → `applyDeltas` → reversal path; failures (aborts included) are swallowed, leaving the turn exactly as it arrived. `mergeRepairBlock` takes the WHOLE repair only when nothing parsed — when a block did parse its ops already ran, so only `options` is taken. This is not a per-turn options call: it is a recovery path for a broken turn.
- **Apply deltas** to the active save: `location`/`day`/`weather` overwrite; `party`/`inventory`/`quests` are op-based. Inventory carries `quantity`; quests carry `reward`.
- **`spoke` is a hint only.** `lastSpokeTurn` updates DETERMINISTICALLY from the prose via loom-spotlight `detectSpeakers` — never trust `spoke` alone.
- **Reversal**: record applied deltas on the message; swipe/regenerate/delete unwinds them (inverse of each op). Scene state restores to the prior message's values. `captureReversal` snapshots `roster` by REFERENCE-DIFF, so any roster helper — `normalizeRoster` included — must return the same array when nothing changed. The global character library is deliberately NEVER captured — undo un-parties, it does not delete.

## Do not

- Do not split narration into multiple messages server-side — one prose `Message`, client segments for display.
- Do not add a second LLM call for options on a turn that produced them — they ride this block. The only extra call is the repair above, on a turn that produced none.
- Do not apply state from prose text; only from the parsed block (except speaker detection).
- Do not let a party op delete a character, write ANY sheet field of a character who already exists (base or override — the sheet is frozen at creation), or re-implement the standing predicates — go through `lib/roster.ts` (`activeMembers`, `partyMembers`, `npcMembers`, `partedMembers`, `isInParty`).
