# RPG System — Attributes, Specialisations, Silent Stakes & GM Moves

**Status: built.** See `CLAUDE.md`'s Post-MVP changelog ("RPG System —
Attributes, Specialisations & the intent classifier") for what actually
shipped and where it lives in the code; this document is kept as the design
rationale, not a second source of truth for the current shape. The decisions
left open below were resolved as: **3 Specialisations per Attribute** at
creation (12 total, from a 4-per-Attribute catalog); Strengths/Flaws
**retired mechanically** — pure flavour text now, no roll effect; and the
sheet's Attribute summary shows the **raw numbers**, not prose-only, for the
narrator (a deliberate deviation from this document's own suggestion below,
made by the player commissioning the build).

This document is a companion to
[`DESIGN.md`](./DESIGN.md), which remains the source of truth for everything it
already covers. It replaces the shipped **`src/lib/stakes.ts`** dice system
(1d6/2d6, `DiceRules`, the visible `DiceOverlay` toss) and the mechanical role
of free-text **Strengths/Flaws** with one coherent character-build system,
while keeping the parts of `stakes.ts` that earned their place: on-device
determinism, regenerate-replays-the-same-result seeding, the authoritative
`OUTCOME` block the narrator must honour, the chip readout, and the
`Conditions` channel a COST result lands on.

## Why

Two problems with the shipped system, both raised during design review:

1. **The risk gate and the Strengths/Flaws bonus are both keyword-matched**
   (`worldNotes.ts → keywordHits` against `RISK_KEYWORDS`, and against the
   character's own free-text Strengths/Flaws). Keyword matching is a surface
   match, not a semantic one — "I sneak a glance at the note" trips the risk
   gate on the word "sneak" alone, with no actual gamble in the sentence. The
   player has to write around their own vocabulary to avoid false triggers,
   which defeats the point of a system meant to be invisible.
2. **Equipment has no mechanical weight.** `Character.equipment` is frozen
   flavour text — `equipLine` renders it, nothing reads it for a roll. A
   looted sword and a butter knife are identical to every system in the game
   except the narrator's prose. Attributes and Skills/Specialisations were
   also entirely absent: every character played identically except for what
   the narrator improvised off free-text Strengths/Flaws, so two different
   adventures with two different premises resolved risk the same way.

The other stated goal: **the roll must stay hidden.** Its purpose is not
player-facing randomness (that's what the existing dice toss animation gave
you) — it's a check the narrator model cannot see coming and cannot talk its
way around, so a model that wants to appease the player by making everything
succeed has no lever to pull. Only the result — banded, in a chip — reaches
the screen.

## Relationship to `stakes.ts`

| Kept from `stakes.ts` | Replaced |
| --- | --- |
| Seeded, regenerate-stable roll (`seedHash(turn, action)`, fair-dice avalanche mixing) | The risk gate itself (`isRisky` / `RISK_KEYWORDS` keyword match) |
| `OUTCOME` block marked *authoritative* — the model narrates the result, it does not pick it | `rollDice` (1d6/2d6 arithmetic) → replaced by a single percentile chance-vs-target roll |
| Chip readout on the beat (`Message.outcome` + a `TurnRoll`-shaped record) | The **visible dice toss** (`diceAnim.ts` + `DiceOverlay.tsx`) — this system is silent by design, see *Presentation* below |
| `Conditions` channel for where a COST/Fail lands | The mechanical role of Strengths/Flaws (`strengthsBonus`/`flawsPenalty`) → replaced by Attributes + Specialisations. Whether free-text Strengths/Flaws stay as pure flavour or retire outright is an **open item**, see bottom. |
| `Settings.stakesRule` (what STRONG/MIXED/COST *mean* narratively) | The band names themselves: STRONG/MIXED/COST become **Great/Mixed/Fail** below, since the math producing them changed shape |

---

## Attributes

Four axes, each an integer **−1 to +3**, frozen on a character the same way
Equipment and Appearance are (`deltas.ts → applyParty` drops the fields on
every op after the creating `add`):

```ts
interface Attributes {
  might: number;    // -1..3 — physical force, endurance
  agility: number;   // -1..3 — speed, precision, reflex
  mind: number;      // -1..3 — knowledge, perception, tactics
  presence: number;  // -1..3 — force of personality, social read
}
```

Each point contributes a flat **±10%** to a roll's chance, converted at the
same clamp `normalizeDice` already uses the pattern for (clamp on *read*,
never on write, so a settings edit can't leave a stored value it never
validated). Attributes are the slow half of the build — a character's
identity — and stay entirely off the narrator's need-to-know for the roll
itself; they're for narration flavour and creation-time choice, not something
the model reasons about numerically.

## Specialisations

A fixed, player-editable **catalog**, one Attribute each, shipped with
defaults and extendable exactly the way `imageTemplates.ts` already lets a
player New / Duplicate / Delete / Reset a named, structured entry:

```ts
interface Specialisation {
  id: string;
  label: string;
  attribute: 'might' | 'agility' | 'mind' | 'presence';
}
```

Lives in `Settings.specialisations` (device-wide ruleset, like `DiceRules`) —
not `GameState` — because it describes *what specialisations exist in this
build's rules*, not anything about one adventure. A character's own picked
set is per-adventure/per-character: `Character.specialisations: string[]`,
referencing catalog `id`s, frozen at creation like everything else on the
sheet. Suggested ship defaults, four per Attribute (naming is a placeholder —
pick whatever reads best against the game's tone):

- **Might** — Athletics, Hammers, Blades, Endurance
- **Agility** — Stealth, Acrobatics, Ranged, Reflexes
- **Mind** — Lore, Perception, Medicine, Tactics
- **Presence** — Persuasion, Deception, Intimidation, Performance

A matched Specialisation adds a flat **+10%**, on top of the Attribute score
— only the single best match applies per roll, not every specialisation the
character happens to hold.

**Character creation:** the player picks starting Specialisations, not the
narrator. Given the catalog is player-editable, the narrator can't reliably
know about additions anyway — and since this is now load-bearing mechanics
rather than flavour text, player intent should decide it, not a model guess.
Whether the starting pick is **3 total** or **3 per Attribute** is an open
item below.

## Equipment

`Equipment` gains two new, purely mechanical, purely player-set fields —
**never model-authored**. The precedent for keeping numeric balance out of
model hands already exists (`equip.ts` refuses Gold specifically because "the
purse is the party's" — the player owns the arithmetic):

```ts
interface Equipment {
  label: string;
  description: string;
  quantity?: number;          // existing — absent = 1
  attributeBonus?: {           // NEW — up to +3, player-set stepper, no model input
    attribute: 'might' | 'agility' | 'mind' | 'presence';
    amount: number;             // 0..3
  };
  grantedSpecialisation?: string; // NEW — a Specialisation catalog id, picker-only
}
```

`grantedSpecialisation` is a **picker into the Specialisation catalog**, not
free text — the same precision-matching discipline the output protocol
already enforces ("use the label already in INVENTORY, exactly as written").
Free text here would reopen the exact keyword-fuzziness problem this whole
system exists to close.

**Stacking cap:** total Attribute contribution from equipment is capped at
the same **+3** range Attributes themselves use — `moveGear`/`equipLine`
sums equipped bonuses for the currently-worn set and clamps, so five rings of
Might is not free +5. This needs to happen in `equip.ts`, at read time,
alongside the existing whole-row-move logic.

`generateItem.ts` (the ✦ item-authoring flow) keeps writing label,
description and quantity exactly as it does today. It does **not** write
`attributeBonus` or `grantedSpecialisation` — those stay plain player-set
fields, same reasoning as the Gold refusal above.

---

## The intent classifier

Replaces `isRisky` / `RISK_KEYWORDS` entirely. A new module, sibling to
`stakes.ts` — call it `intent.ts` — running one side call via
`openrouter.ts → completeChat` on `settings.cheapModelId`, the same model
already trusted with `repairBlock`/`generateField`/`generateItem`'s
structured-question calls.

**Why not let the narrator self-report risk:** this was considered and
rejected. Asking the narrator's own model "was that risky?" as part of its
own turn is the appeasement bug wearing a different hat — a model under
narration incentive, asked whether to invite a check that might make it say
no to its own player, will simply say no. The classifier has to be a
separate call, with a cold, non-roleplay prompt and zero stake in the
narrative outcome. Smaller/cheaper models also tend to be less sycophantic
than a narration-tuned model — a nice side effect, not the load-bearing
reason.

**Scope kept tight**, matching how every other side call in this app reads
only what it needs (`generateItem.ts` never reads the beats, `generatePlace`
never reads more than the current scene):

- **Input:** the player's action text, one line of current scene context, and
  the *acting character's own* Specialisation list (3-ish entries) — never
  the whole global catalog, never the full history.
- **Output:** a structured verdict, not a bare boolean —

```ts
interface IntentVerdict {
  risky: boolean;
  attribute: 'might' | 'agility' | 'mind' | 'presence' | null;
  specialisation: string | null; // a Specialisation id from the scoped list, or null
}
```

**Determinism, and why it matters here specifically:** the existing dice roll
is seeded on `(turn, action)` precisely so ↻ Regen replays the same result —
that's load-bearing trust (seeding is what stops "fishing for a better roll"
by regenerating). An LLM classifier call is *not* deterministic. Left
unhandled, a regenerate could reclassify a risky action as safe and dodge a
roll it already got caught by. Fix: cache the verdict alongside the existing
`TurnRoll` record (reversal snapshot / `Message`), so `regenerateLastTurn`
reuses the stored verdict rather than re-classifying. Classify once per turn,
replay forever after — same discipline the dice seed already has.

**Fail-open.** A classifier call error (network, rate limit, malformed JSON)
resolves to `{ risky: false, attribute: null, specialisation: null }` — no
roll, no block, narrator free-forms exactly as a genuinely non-risky turn
does today. Matches the app's existing fail-open contract (`verifyOps.ts`'s
subtract-only posture) and the existing "a non-risky turn injects no block at
all" rule from `stakes.ts` — an extra network round-trip must degrade quiet,
never loud, never block the turn.

**Real cost, stated plainly:** this adds one sequential round-trip before
narration starts, on every stakes-relevant turn. The keyword gate it replaces
was free — client-side, zero latency. A fast/cheap model keeps the add small,
but it is not nothing, and it's an extra dependency on OpenRouter staying up
per turn rather than the previous fully-on-device gate. Worth confirming
that trade is acceptable before building — it's the one place this design
gives up something `stakes.ts` was proud of (see the "on-device, no extra LLM
call" framing in `DESIGN.md`'s own Stakes section).

**Not bulletproof either.** This swaps a deterministic, debuggable false
positive ("sneak" always matches) for a probabilistic one (LLM misjudgement,
harder to reproduce). Better semantic accuracy, worse debuggability. Good
few-shot examples in the classifier's system prompt — including the "sneak a
glance" counter-example that started this thread — help but don't guarantee
it never misfires.

---

## The roll

Percentile, computed entirely client-side once the classifier verdict is in
hand — same "deterministic signal, no extra LLM call for the arithmetic
itself" posture `stakes.ts` already has, just for the *math*, not the *gate*.

**Target Number (TN):**

```
TN = clamp(
  Settings.baseChance                      // default 20
  + attribute[verdict.attribute] * 10       // -10..+30
  + equipmentBonus[verdict.attribute] * 10  // 0..+30, capped per Equipment section
  + (verdict.specialisation matched ? 10 : 0),
  MIN_TN, MAX_TN                             // e.g. 5..95 — see floor/ceiling below
)
```

**The roll itself** reuses the existing fair-seeding discipline verbatim —
hash `turn|action` through the same avalanche/murmur3-finalizer mixing
`stakes.ts` already fixed two real bugs to get right (a raw FNV hash leaking
its low bit into `% sides`, and per-die seed suffixes locking dice into
correlated parities). Take the result `% 100 + 1` for a roll in `1..100`.

**Floor and ceiling on TN.** Standard percentile-system convention (the same
reason Call of Cthulhu-style systems keep a crit-fail/crit-success sliver at
both ends): clamp TN to **5–95**, never 0 or 100. A −1-Attribute character
with nothing going for them should still have a sliver of luck, and a
maxed-out +3/+3/gear/specialisation character (a genuine 20+30+10+30=90 stack
under shipped defaults) should still be able to roll badly. This needs its
own `normalizeStats`-style sanitizer, same spirit as `normalizeDice`.

## Outcome bands

The margin idea from design review — bands scaled proportionally to TN,
rather than fixed thresholds — is good, but the first pass had the direction
inverted relative to the premise that TN itself equals the percent chance to
succeed. Resolved version, checked against that premise directly:

```
marginSize = clamp(round(0.2 × TN), 2, TN − 1)

Fail:  roll > TN
Mixed: TN − marginSize < roll ≤ TN
Great: roll ≤ TN − marginSize
```

Worked example, TN = 90 (marginSize = 18): **Great** = rolls 1–72 (72%),
**Mixed** = 73–90 (18%), **Fail** = 91–100 (10%). Great + Mixed = 90 = TN,
exactly the stated success chance — Fail is always exactly `100 − TN`, by
construction. Low end, TN = 10 (marginSize = 2): **Great** = 1–8 (8%),
**Mixed** = 9–10 (2%), **Fail** = 11–100 (90%) — same shape, same guarantee.

This is the piece most worth pinning to an exact spec before code, since an
off-by-one here (`≤` vs `<`) silently shifts one whole percentage point of
outcome between bands.

## Presentation

**Silent — no dice toss.** This whole system is designed to be invisible
until the result lands. `diceAnim.ts` and `DiceOverlay.tsx`, and the RPG
System → Presentation screen that configures the toss (`diceAnimation`,
`dicePitch`/`diceYaw`/`dicePerspective`, *Test Roll*), are retired along with
the dice math they animate — there's no physical die being thrown anymore,
just an abstract percentile check, so a cube-toss animation would be
presenting a mechanic that no longer exists underneath it.

**The chip is the only surface.** Same slot `stakes.ts` already uses on the
narrator `Message` — one inverted chip above the beat's state-change toasts.
Suggested content, following the existing "show the arithmetic, not just the
verdict" reasoning (`stakes.ts`'s own rationale: *"The verdict alone read as
the app editorialising about the beat; the numbers show it was a die"*) —
same logic applies here even without a physical die:

> `Might +2, Hammers specialisation, gear +1 · 40% chance · Success`

---

## GM Moves

A second player-editable catalog, same shape and same UI pattern as
Specialisations (and `imageTemplates.ts` before it):

```ts
interface GMMove {
  id: string;
  label: string;
  description: string;
}
```

Ship **Dungeon World**-derived defaults (reveal an unwelcome truth, deal
damage, separate them, put someone in a spot, offer an opportunity with a
cost, show signs of an approaching threat, turn their move back on them...).
**Attribution required if the actual move text ships** — Dungeon World's
moves are CC BY 3.0, Sage LaTorra & Adam Koebel, the exact license already
credited in `.claude/skills/ATTRIBUTION.md`-adjacent territory for
`places.ts`'s steading tag vocabulary. Same treatment applies here, don't
skip it.

**Two trigger points**, both already natural seams in the existing turn flow:

- A **Fail** result — the narrator reaches for a move to shape the
  consequence, instead of freelancing one.
- A **quiet/hesitant turn** — no clear risky action, the PbtA "soft move"
  moment (foreshadow, offer opportunity with cost) — the same territory
  `stakes.ts` explicitly declines to roll on today ("I look around" injects
  no block).

One flat list for both, at least for a first version — a prompt note saying
*"reach for one of these on a Fail, or when the player hesitates"* is enough;
splitting the catalog into cost-only/soft-only sub-lists is not obviously
worth the complexity yet.

**Prompt tier placement:** standing context (tier 1, alongside Narrator
Instructions), not turn context — it's a stable reference toolbox, not
something that needs keyword-gating per turn.

**Feature gate:** no new `Settings.features` boolean. Gate it on the existing
`stakesEnabled` — a GM Moves list is meaningless without stakes existing at
all, and the app doesn't need a fifteenth toggle for something that only
ever matters alongside a fourteenth.

---

## Settings surface (sketch)

Following the existing rule — **every number is a setting**, sanitized at
read time, never on write:

```ts
// Settings, additions
attributeRules: {
  baseChance: number;        // default 20
  attributePoint: number;    // % per Attribute point, default 10
  specialisationBonus: number; // flat %, default 10
  minChance: number;         // default 5
  maxChance: number;         // default 95
  mixedMarginPct: number;    // default 20 (the "0.2 x TN" factor)
  minMargin: number;         // default 2
},
specialisations: Specialisation[],
gmMoves: GMMove[],
```

RPG System screen restructures around this: **Attributes & Specialisations**
(the rules above, plus the catalog editor), **GM Moves** (catalog editor),
**Results** (band math, same slot `stakesRule` occupies today), replacing the
current dice-focused layout. The Presentation sub-screen goes away with the
toss.

## Systems touched (full list)

- **`types.ts`** — `Character` gains `attributes`, `specialisations: string[]`;
  `Equipment` gains `attributeBonus?`, `grantedSpecialisation?`.
- **`stakes.ts`** — `rollDice`/`TurnRoll`/`formatRoll` rewritten for the
  percentile model; `seedHash` and the avalanche mixing carry over unchanged.
- **New `intent.ts`** — the classifier call and its caching.
- **New `attributes.ts`** (or similar) — the Specialisation catalog table,
  parallel to `places.ts → PLACE_KINDS`.
- **`prompt.ts` / `roster.ts → formatTraits`** — sheet block gains an
  Attributes/Specialisations summary (prose, for narrator flavour only — the
  actual numbers and TN math stay entirely client-side); GM Moves block added
  to tier 1.
- **`toasts.ts`** — new chip renderer.
- **`reversal.ts`** — `TurnRoll` extended to store the classifier verdict
  alongside the roll, for regenerate-replay consistency.
- **`autoUpdate.ts`** — must explicitly exclude Attributes/Specialisations
  from re-dressing, same as it already excludes Strengths/Flaws/Equipment.
- **`equip.ts`** — equip/unequip now has a mechanical side effect (attribute
  bonus, granted specialisation on/off), not just inventory bookkeeping;
  `equipLine` needs to surface it on the member sheet.
- **Character creation UI** — new: a starting-Attributes and
  starting-Specialisations picker, since these are now player-authored.
- **Migration** — no existing save has Attribute fields. Default every
  loaded character to all-zero Attributes and an empty Specialisation list on
  read (same posture the codebase already takes on every other breaking
  change — hard cut, `normalize*` fills the gap, no shim).

## Open items to confirm before this is built

- **3 Specialisations total, or 3 per Attribute** at character creation? The
  original phrasing ("a character has 3 specialisations to begin with") reads
  as total, but per-Attribute changes the build's shape a lot.
- **Strengths/Flaws — retired, or kept as pure flavour text** now that
  Attributes/Specialisations own the mechanical bonus role? Two overlapping
  systems (one keyword-matched, one classifier-matched) is worse than one.
- **Narrator-visible Attribute summary** — confirm the sheet block should
  describe a character's build in prose ("strong, quick-tempered") without
  ever stating the numbers, consistent with how the OUTCOME band is
  authoritative but the roll that produced it never was.
- Exact **off-by-one convention** on the Mixed/Great boundary (`≤` vs `<`) —
  pinned above, but worth a second look against playtest feel before it's
  load-bearing.
