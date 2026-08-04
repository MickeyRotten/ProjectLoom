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
- **Options** = the AI action buttons, inline in the same call — no extra request per turn. Render under the latest beat, above the party strip. Number keys submit.
- **Apply deltas** to the active save: `location`/`day`/`weather` overwrite; `party`/`inventory`/`quests` are op-based. Inventory carries `quantity`; quests carry `reward`.
- **`spoke` is a hint only.** `lastSpokeTurn` updates DETERMINISTICALLY from the prose via loom-spotlight `detectSpeakers` — never trust `spoke` alone.
- **Reversal**: record applied deltas on the message; swipe/regenerate/delete unwinds them (inverse of each op). Scene state restores to the prior message's values. `captureReversal` snapshots `roster` by REFERENCE-DIFF, so any roster helper — `normalizeRoster` included — must return the same array when nothing changed. The global character library is deliberately NEVER captured — undo un-parties, it does not delete.

## Do not

- Do not split narration into multiple messages server-side — one prose `Message`, client segments for display.
- Do not add a second LLM call for options — they ride this block.
- Do not apply state from prose text; only from the parsed block (except speaker detection).
- Do not let a party op delete a character, write ANY sheet field of a character who already exists (base or override — the sheet is frozen at creation), or re-implement the standing predicates — go through `lib/roster.ts` (`activeMembers`, `partyMembers`, `npcMembers`, `partedMembers`, `isInParty`).
