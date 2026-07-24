import type { Character } from "../types";

/**
 * Party spotlight — deterministic, single-call (see
 * .claude/skills/loom-spotlight/SKILL.md; read before editing).
 *
 * NO per-member classifier LLM call. Every turn we compute cheap local
 * signals, inject one PARTY SPOTLIGHT block into the prompt, and let the
 * narrator judge within its generation. After the turn, `detectSpeakers`
 * bumps `lastSpokeTurn` DETERMINISTICALLY from the prose — the model's
 * `spoke` hint never overrides it. Ported from Wayward's spotlight.py.
 */

/** Common English words dropped from keyword extraction. */
export const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "his", "her",
  "she", "him", "they", "them", "their", "was", "were", "with", "from",
  "this", "that", "these", "those", "have", "has", "had", "will", "would",
  "could", "should", "can", "may", "into", "onto", "over", "under", "out",
  "off", "then", "than", "there", "here", "what", "when", "where", "who",
  "how", "why", "all", "any", "some", "each", "just", "like", "one", "two",
  "get", "got", "him", "our", "its", "about", "around", "toward", "before",
  "after", "again", "still", "very", "much", "more", "most", "such", "only",
  "own", "same", "been", "being", "does", "did", "done", "now", "yet",
]);

/** Group-address phrases that address the whole party (HARD override). */
export const GROUP_ADDRESS_RE =
  /\b(?:we|us|everyone|everybody|you all|you guys|y'?all|party|team|group|all of you|both of you)\b/i;

/** Attribution verbs — a name adjacent to one of these counts as speaking. */
export const SAID_VERBS = [
  "said", "says", "say", "asked", "asks", "ask", "replied", "replies",
  "reply", "shouted", "shouts", "shout", "whispered", "whispers", "whisper",
  "muttered", "mutters", "mutter", "called", "calls", "answered", "answers",
  "yelled", "yells", "growled", "growls", "murmured", "murmurs", "added",
  "adds", "continued", "continues", "hissed", "hisses", "snapped", "snaps",
  "grunted", "grunts", "warned", "warns", "offered", "offers", "breathed",
];

/** Quote glyphs we treat as dialogue delimiters (straight + curly). */
const QUOTE_CLASS = `"“”`;

export interface SpotlightSignal {
  id: string;
  name: string;
  /** Player addressed this member by name, or addressed the whole group. */
  directlyAddressed: boolean;
  /** Field Skill keywords overlap the message + recent scene context. */
  fieldSkillRelevant: boolean;
  /** currentTurn − lastSpokeTurn. Large ⇒ overdue. */
  turnsSinceLastSpoke: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex-source alternation matching a member's full name OR first token,
 * both escaped. Used everywhere a name is matched, word-bounded elsewhere.
 */
export function namePattern(name: string): string {
  const full = name.trim();
  const first = full.split(/\s+/)[0] ?? "";
  // Keep the full name always; add the first-token alias only when it isn't a
  // stopword — "The Butcher" would otherwise make every "the" read as
  // addressing them.
  const forms = [full];
  if (first && !STOPWORDS.has(first.toLowerCase())) forms.push(first);
  return Array.from(new Set(forms)).filter(Boolean).map(escapeRegExp).join("|");
}

/**
 * Keywords for relevance matching: lowercase tokens of length ≥ 4, minus
 * stopwords. Field Skill NAME tokens are always kept (they carry the signal
 * even when short, e.g. "lock", "map").
 */
export function extractKeywords(text: string, keepShort: Iterable<string> = []): Set<string> {
  const keep = new Set(Array.from(keepShort, (w) => w.toLowerCase()));
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (keep.has(w)) {
      out.add(w);
      continue;
    }
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Lowercase word tokens of a Field Skill name (always count as keywords). */
function skillNameTokens(skillName: string): string[] {
  return (skillName.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/**
 * directlyAddressed — the player named the member (full name or first token,
 * word-boundary, case-insensitive) OR used a group address. HARD override.
 */
export function isDirectlyAddressed(message: string, name: string): boolean {
  if (GROUP_ADDRESS_RE.test(message)) return true;
  const re = new RegExp(`\\b(?:${namePattern(name)})\\b`, "i");
  return re.test(message);
}

/**
 * Compute per-member signals for the in-party roster. `recentContext` is a
 * short window of recent scene text (last few beats) folded into the
 * relevance check alongside the player's new message.
 */
export function computeSpotlightSignals(
  playerMsg: string,
  recentContext: string,
  party: Character[],
  currentTurn: number,
): SpotlightSignal[] {
  const contextKeywords = extractKeywords(`${playerMsg}\n${recentContext}`);

  return party.map((m) => {
    const nameTokens = skillNameTokens(m.fieldSkill?.name ?? "");
    const skillKeywords = extractKeywords(
      `${m.fieldSkill?.name ?? ""} ${m.fieldSkill?.description ?? ""}`,
      nameTokens,
    );
    const fieldSkillRelevant = intersects(contextKeywords, skillKeywords);

    return {
      id: m.id,
      name: m.name,
      directlyAddressed: isDirectlyAddressed(playerMsg, m.name),
      fieldSkillRelevant,
      turnsSinceLastSpoke: Math.max(0, currentTurn - (m.lastSpokeTurn ?? 0)),
    };
  });
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) return true;
  return false;
}

/**
 * The PARTY SPOTLIGHT — THIS TURN block: one line per member plus the
 * (editable) rule. Empty string when the party is empty (no block injected).
 */
export function formatSpotlightBlock(signals: SpotlightSignal[], rule: string): string {
  if (!signals.length) return "";
  const lines = signals.map((s) => {
    const addressed = s.directlyAddressed ? "yes" : "no";
    const relevant = s.fieldSkillRelevant ? "yes" : "no";
    return `- ${s.name}: addressed=${addressed} · skill-relevant=${relevant} · last spoke ${s.turnsSinceLastSpoke} turn(s) ago`;
  });
  return [
    "PARTY SPOTLIGHT — THIS TURN",
    ...lines,
    "",
    `RULE: ${rule.trim()}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Relevant gear — the same keyword machinery as Field Skill relevance,
 * applied to equipped items. When an equipped item's label/description
 * keywords surface in the player's message or the recent scene, the item's
 * full name + description is spotlighted in its own prompt block so the
 * narrator actually uses it. Deterministic, no extra LLM call.
 * ------------------------------------------------------------------ */

export interface GearSignal {
  /** Name of the character carrying the item (PC or in-party member). */
  owner: string;
  label: string;
  description: string;
}

/**
 * Equipped items whose keywords overlap the message + recent context.
 * Label tokens always count (they carry the signal even when short, like
 * Field Skill name tokens — "rope", "map").
 */
export function computeRelevantGear(
  playerMsg: string,
  recentContext: string,
  characters: Character[],
): GearSignal[] {
  // Keep every label token in the context scan too, so a short label like
  // "Map" can still meet its own keyword in the player's message.
  const allLabelTokens = characters.flatMap((c) =>
    (c.equipment ?? []).flatMap((e) => skillNameTokens(e.label)),
  );
  const contextKeywords = extractKeywords(`${playerMsg}\n${recentContext}`, allLabelTokens);
  const out: GearSignal[] = [];
  for (const c of characters) {
    for (const e of c.equipment ?? []) {
      if (!e.label) continue;
      const gearKeywords = extractKeywords(
        `${e.label} ${e.description ?? ""}`,
        skillNameTokens(e.label),
      );
      if (intersects(contextKeywords, gearKeywords)) {
        out.push({ owner: c.name, label: e.label, description: e.description ?? "" });
      }
    }
  }
  return out;
}

/** The RELEVANT GEAR block; empty string when nothing matched (no block). */
export function formatGearBlock(matches: GearSignal[]): string {
  if (!matches.length) return "";
  const lines = matches.map(
    (g) => `- ${g.owner} — ${g.label}${g.description ? `: ${g.description}` : ""}`,
  );
  return [
    "RELEVANT GEAR — THIS TURN (equipped items that may bear on this action; weave them in naturally)",
    ...lines,
  ].join("\n");
}

/**
 * `_member_spoke` port. True when `text` attributes an actual line to the
 * member — name adjacent to a quote or a said-verb:
 *   • `Name: "…"`         (the dialogue convention)
 *   • `Name … said`       (name then said-verb, same clause)
 *   • `said … Name`       (said-verb then name, same clause)
 *   • `"…" Name`          (quote close then name attribution)
 * A bare mention ("Tifa was asleep") does NOT count.
 */
export function memberSpoke(text: string, name: string): boolean {
  const n = namePattern(name);
  const verbs = SAID_VERBS.join("|");
  const q = QUOTE_CLASS;

  const patterns = [
    // Name: "…"
    new RegExp(`\\b(?:${n})\\b\\s*:\\s*[${q}]`, "i"),
    // Name …said  — same clause (no sentence break / quote between)
    new RegExp(`\\b(?:${n})\\b[^.!?${q}]{0,40}?\\b(?:${verbs})\\b`, "i"),
    // said… Name  — same clause
    new RegExp(`\\b(?:${verbs})\\b[^.!?${q}]{0,40}?\\b(?:${n})\\b`, "i"),
    // `…," Name`  — comma inside the closing quote, then the name (attribution).
    // Reject a possessive so `"Run," Bob's mother urged` doesn't credit Bob.
    new RegExp(`,\\s*[${q}]\\s*(?:${n})\\b(?!['’]s\\b)`, "i"),
    // `…" Name said`  — closing quote, name, then a said-verb
    new RegExp(`[${q}]\\s*(?:${n})\\b\\s+(?:${verbs})\\b`, "i"),
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * Speaker detection — the anti-drift backstop. Returns the ids of in-party
 * members actually attributed a line in `responseText`. Callers bump those
 * members' `lastSpokeTurn`. The model's `spoke` hint is ignored here.
 */
export function detectSpeakers(responseText: string, party: Character[]): string[] {
  const ids: string[] = [];
  for (const m of party) {
    if (m.name && memberSpoke(responseText, m.name)) ids.push(m.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Display segmenter — SAME `Name: "…"` convention as speaker detection.
 * Splits a narrator beat into prose runs and attributed dialogue so the
 * UI can style party lines. Wired once alongside the detector above.
 * ------------------------------------------------------------------ */

export interface Segment {
  /** Canonical member name when this run is attributed dialogue, else null. */
  speaker: string | null;
  /** Prose text, or the quoted line (without the `Name:` prefix). */
  text: string;
}

export function segmentDialogue(text: string, party: Character[]): Segment[] {
  const named = party.filter((m) => m.name);
  if (!named.length) return text ? [{ speaker: null, text }] : [];

  // Resolve a matched token (full name or first) back to the canonical name.
  const lookup = new Map<string, string>();
  for (const m of named) {
    lookup.set(m.name.toLowerCase(), m.name);
    const first = m.name.trim().split(/\s+/)[0];
    if (first) lookup.set(first.toLowerCase(), m.name);
  }

  const alt = named.map((m) => namePattern(m.name)).join("|");
  const q = QUOTE_CLASS;
  const re = new RegExp(`\\b(${alt})\\s*:\\s*[${q}]([^${q}]*)[${q}]`, "gi");

  const segments: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      const prose = text.slice(last, match.index);
      if (prose.trim()) segments.push({ speaker: null, text: prose });
    }
    const speaker = lookup.get(match[1].toLowerCase()) ?? match[1];
    segments.push({ speaker, text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    if (tail.trim()) segments.push({ speaker: null, text: tail });
  }

  return segments.length ? segments : [{ speaker: null, text }];
}
