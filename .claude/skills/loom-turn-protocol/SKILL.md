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
  "party":     [ { "op": "add", "name": "Riley", "species": "human", "description": "...", "fieldSkill": { "name": "...", "description": "..." } } ],
  "inventory": [ { "op": "add", "label": "Cracked Compass", "description": "...", "quantity": 1 } ],
  "quests":    [ { "op": "add", "label": "Reach the Old Settlement", "description": "...", "reward": "..." } ],
  "spoke": ["Navi"]
}
<<<END>>>
```

All block fields optional except when state changed. `op`: `add` | `update` | `remove`.

## Client contract (invariants)

- **Stream display truncates at first `<<<`** — JSON never flashes mid-stream.
- **Parse tolerant**: brace-matched salvage; ALWAYS strip the block from displayed prose even if JSON malformed (bad JSON must never leak into chat).
- **Options** = the AI action buttons, inline in the same call — no extra request per turn. Render under the latest beat, above the party strip. Number keys submit.
- **Apply deltas** to the active save: `location`/`day`/`weather` overwrite; `party`/`inventory`/`quests` are op-based. Inventory carries `quantity`; quests carry `reward`.
- **`spoke` is a hint only.** `lastSpokeTurn` updates DETERMINISTICALLY from the prose via loom-spotlight `detectSpeakers` — never trust `spoke` alone.
- **Reversal**: record applied deltas on the message; swipe/regenerate/delete unwinds them (inverse of each op). Scene state restores to the prior message's values.

## Do not

- Do not split narration into multiple messages server-side — one prose `Message`, client segments for display.
- Do not add a second LLM call for options — they ride this block.
- Do not apply state from prose text; only from the parsed block (except speaker detection).
