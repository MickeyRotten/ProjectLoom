---
name: loom-spotlight
description: >
  Project Loom's party spotlight rules — the deterministic logic deciding when a
  party member speaks, and how last-spoke tracking works. Ported from Wayward's
  spotlight.py. Use when editing spotlight.ts, the party dialogue convention, the
  prompt's PARTY SPOTLIGHT block, or lastSpokeTurn updates. Protects the
  crown-jewel logic from drift.
---

Spotlight stays deterministic + single-call. NO per-member classifier LLM call. Compute cheap local signals, inject once into the prompt, let the narrator judge within its generation.

## Signals (computed every turn, pre-call)

Per in-party member:
- **directlyAddressed** — player message contains member name (full OR first token, word-boundary, case-insensitive) OR a group address (`we`, `everyone`, `you all`, `you guys`, `party`, `team`, `group`, `everybody`). HARD override.
- **fieldSkillRelevant** — keyword overlap between (message + recent scene context) and the member's Field Skill name+description. Soft bias. Extract keywords: lowercase words len≥4, minus stopwords; skill NAME tokens count.
- **turnsSinceLastSpoke** = currentTurn − lastSpokeTurn. Soft bias.

## Prompt block

Inject a `PARTY SPOTLIGHT — THIS TURN` block every call: one line per member (addressed? · skill-relevant? · last spoke N turns ago) + the RULE. Rule (editable in Settings, default):

> Voice a party member only when directly addressed, clearly relevant, or significantly overdue. Default to silence — most turns nobody speaks. If directly addressed, they MUST respond. Never more than one react to the same beat unless the player addressed the whole group. When voiced, one or two sentences, in character + true to Field Skill.

directlyAddressed = hard "must respond"; the other two = soft nudges, never forced.

## Relevant gear (same machinery, separate block)

`computeRelevantGear` reuses the keyword extractor on equipped items (PC + in-party):
label tokens always count (like skill NAME tokens); a match against the message +
recent context injects a `RELEVANT GEAR — THIS TURN` block with the item's full
name + description. Soft signal only — never forces anyone to speak, never an LLM call.

## Dialogue convention + last-spoke (deterministic)

Party dialogue line: `Name: "…"` where Name resolves to an in-party member. SAME convention drives the display segmenter AND speaker detection — wire once.

`detectSpeakers(responseText, party)` bumps `lastSpokeTurn` ONLY for members actually attributed a line — name adjacent to a quote or a said-verb (`Name: "…"`, `Name … said`, `said … Name`, `…" Name`). A bare mention ("Tifa was asleep") does NOT count. Port `_member_spoke` faithfully; it's the anti-drift backstop.

## Do not

- Do not add an LLM call to decide who speaks.
- Do not treat a bare name mention as speaking.
- Do not let the model's `spoke` hint override deterministic detection.
