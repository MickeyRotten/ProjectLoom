import { ATTRIBUTES } from "../types";
import type { Attribute, AttributeRules, Attributes, Character, Specialisation } from "../types";

/**
 * The RPG System build (RPG_DESIGN.md) — Attributes, the Specialisation
 * catalog, and the Target Number math they feed. `stakes.ts` is the sibling
 * that turns this into an actual roll; this module is the data half: what the
 * four axes are, what specialisations exist, and how a TN is assembled from
 * them. Pure and dependency-light on purpose, the same posture
 * `imageTemplates.ts` and `places.ts` take on their own catalogs, so
 * `equip.ts`, `prompt.ts`, `defaults.ts` and the RPG System / member-sheet
 * screens can all read it without pulling in the network-calling half.
 */

/** Display labels, in the order every Attribute picker lists them. */
export const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  might: "Might",
  agility: "Agility",
  mind: "Mind",
  presence: "Presence",
};

/** One line of flavour per Attribute, for the creation/edit UI. */
export const ATTRIBUTE_HINTS: Record<Attribute, string> = {
  might: "Physical force, endurance.",
  agility: "Speed, precision, reflex.",
  mind: "Knowledge, perception, tactics — spotting what's hidden, gleaning insight from a search or a clue.",
  presence: "Force of personality, social read.",
};

export const MIN_ATTRIBUTE = -1;
export const MAX_ATTRIBUTE = 3;

/** Clamp one Attribute score into the −1..3 range a corrupt/hand-edited save could break. */
function clampAttribute(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ATTRIBUTE, Math.max(MIN_ATTRIBUTE, Math.round(n)));
}

/** A fresh, all-zero build — what a brand-new character starts from. */
export function defaultAttributes(): Attributes {
  return { might: 0, agility: 0, mind: 0, presence: 0 };
}

/**
 * Sanitize a stored/edited build at READ time, same posture `stakes.ts` used
 * to give `DiceRules` — a missing or corrupt score reads as 0 rather than
 * breaking the roll.
 */
export function normalizeAttributes(raw: Partial<Attributes> | undefined): Attributes {
  const out = defaultAttributes();
  if (!raw) return out;
  for (const a of ATTRIBUTES) out[a] = clampAttribute(raw[a]);
  return out;
}

/** A character's build, defaulting to all-zero when absent (a save from before this existed). */
export function characterAttributes(c: Pick<Character, "attributes">): Attributes {
  return normalizeAttributes(c.attributes);
}

/** A character's held Specialisation ids, defaulting to none. */
export function characterSpecialisations(c: Pick<Character, "specialisations">): string[] {
  return Array.isArray(c.specialisations) ? c.specialisations.filter((s) => typeof s === "string") : [];
}

/* ------------------------------------------------------------------ *
 * The Specialisation catalog (RPG System → Attributes & Specialisations).
 * ------------------------------------------------------------------ */

/**
 * The shipped catalog — four per Attribute, naming a placeholder pool to pick
 * from at character creation. Ids are stable so a player's held set survives
 * a Reset of the catalog's wording.
 */
export function defaultSpecialisations(): Specialisation[] {
  return [
    { id: "athletics", label: "Athletics", attribute: "might" },
    { id: "hammers", label: "Hammers", attribute: "might" },
    { id: "blades", label: "Blades", attribute: "might" },
    { id: "endurance", label: "Endurance", attribute: "might" },
    { id: "stealth", label: "Stealth", attribute: "agility" },
    { id: "acrobatics", label: "Acrobatics", attribute: "agility" },
    { id: "ranged", label: "Ranged", attribute: "agility" },
    { id: "reflexes", label: "Reflexes", attribute: "agility" },
    { id: "lore", label: "Lore", attribute: "mind" },
    { id: "perception", label: "Perception", attribute: "mind" },
    { id: "medicine", label: "Medicine", attribute: "mind" },
    { id: "tactics", label: "Tactics", attribute: "mind" },
    { id: "persuasion", label: "Persuasion", attribute: "presence" },
    { id: "deception", label: "Deception", attribute: "presence" },
    { id: "intimidation", label: "Intimidation", attribute: "presence" },
    { id: "performance", label: "Performance", attribute: "presence" },
  ];
}

/** A fresh id for a player-added specialisation — never reused. */
function specialisationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A new, blank catalog row — the "+ Specialisation" tap. */
export function newSpecialisation(label = "", attribute: Attribute = "might"): Specialisation {
  return { id: specialisationId(), label, attribute };
}

function isAttribute(v: unknown): v is Attribute {
  return (ATTRIBUTES as readonly string[]).includes(v as string);
}

/**
 * Fold whatever storage holds onto a usable catalog — sanitized at READ time,
 * like `imageTemplates.ts → normalizeImageTemplates`. Never empty: an empty
 * catalog would leave a classifier verdict with nothing to match and a
 * creation screen with nothing to pick, and there is no way back from either.
 */
export function normalizeSpecialisations(stored: unknown): Specialisation[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const out: Specialisation[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<Specialisation>;
    const id = typeof row.id === "string" && row.id.trim() ? row.id : specialisationId();
    if (seen.has(id)) continue;
    const label = typeof row.label === "string" ? row.label : "";
    const attribute = isAttribute(row.attribute) ? row.attribute : "might";
    seen.add(id);
    out.push({ id, label, attribute });
  }
  return out.length ? out : defaultSpecialisations();
}

/** Look a Specialisation up by id — "" when the catalog no longer has it. */
export function specialisationLabel(catalog: Specialisation[], id: string | null | undefined): string {
  if (!id) return "";
  return catalog.find((s) => s.id === id)?.label ?? "";
}

/**
 * The `Build:` line a character sheet prints for the narrator — one line
 * naming the four Attribute scores and any held Specialisations, plainly, in
 * numbers. `""` for a character nobody has built yet (all-zero, no
 * specialisations), so a fresh companion's sheet doesn't carry a line of
 * zeroes.
 */
export function formatBuild(c: Pick<Character, "attributes" | "specialisations">, catalog: Specialisation[]): string {
  const attrs = characterAttributes(c);
  const held = characterSpecialisations(c);
  const built = ATTRIBUTES.some((a) => attrs[a] !== 0);
  if (!built && !held.length) return "";
  const scores = ATTRIBUTES.map((a) => `${ATTRIBUTE_LABELS[a]} ${attrs[a] >= 0 ? "+" : ""}${attrs[a]}`).join(
    ", ",
  );
  const specs = held.map((id) => specialisationLabel(catalog, id)).filter(Boolean);
  return specs.length ? `Build: ${scores} — Specialisations: ${specs.join(", ")}` : `Build: ${scores}`;
}

/* ------------------------------------------------------------------ *
 * The percentile math (RPG_DESIGN.md → The roll / Outcome bands). Pure
 * arithmetic — `stakes.ts` supplies the actual (seeded) roll.
 * ------------------------------------------------------------------ */

export const DEFAULT_ATTRIBUTE_RULES: AttributeRules = {
  baseChance: 20,
  attributePoint: 10,
  specialisationBonus: 10,
  minChance: 5,
  maxChance: 95,
  mixedMarginPct: 20,
  minMargin: 2,
};

/** Generous ceilings for the player-entered percentages — a house rule, not a bug. */
export const MAX_BASE_CHANCE = 100;
export const MAX_POINT_VALUE = 50;
export const MAX_MARGIN_PCT = 100;
export const MAX_MARGIN_POINTS = 50;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Sanitize a stored/edited rule set at READ time — same discipline
 * `stakes.ts → normalizeDice` used to give `DiceRules`. `minChance`/
 * `maxChance` are reconciled against each other so a typo can't leave the
 * floor above the ceiling, and `minMargin` is pinned inside 0..49 so a MIXED
 * band can never swallow the whole 1..100 range.
 */
export function normalizeAttributeRules(raw: Partial<AttributeRules> | undefined): AttributeRules {
  const r = { ...DEFAULT_ATTRIBUTE_RULES, ...(raw ?? {}) };
  const baseChance = clampInt(r.baseChance, 0, MAX_BASE_CHANCE, DEFAULT_ATTRIBUTE_RULES.baseChance);
  const attributePoint = clampInt(
    r.attributePoint,
    -MAX_POINT_VALUE,
    MAX_POINT_VALUE,
    DEFAULT_ATTRIBUTE_RULES.attributePoint,
  );
  const specialisationBonus = clampInt(
    r.specialisationBonus,
    0,
    MAX_POINT_VALUE,
    DEFAULT_ATTRIBUTE_RULES.specialisationBonus,
  );
  const minChance = clampInt(r.minChance, 1, 99, DEFAULT_ATTRIBUTE_RULES.minChance);
  const maxChance = clampInt(r.maxChance, minChance, 99, DEFAULT_ATTRIBUTE_RULES.maxChance);
  const mixedMarginPct = clampInt(
    r.mixedMarginPct,
    0,
    MAX_MARGIN_PCT,
    DEFAULT_ATTRIBUTE_RULES.mixedMarginPct,
  );
  const minMargin = clampInt(r.minMargin, 0, 49, DEFAULT_ATTRIBUTE_RULES.minMargin);
  return { baseChance, attributePoint, specialisationBonus, minChance, maxChance, mixedMarginPct, minMargin };
}

/** One piece of a Target Number, for the frozen chip breakdown. */
export interface TNPart {
  label: string;
  amount: number;
}

/** The assembled Target Number, plus every part that built it (for the chip). */
export interface TargetNumber {
  tn: number;
  parts: TNPart[];
}

/**
 * Assemble the Target Number (RPG_DESIGN.md → The roll):
 * `base + attribute × attributePoint + gearBonus × attributePoint + (specialisation matched ? bonus : 0)`,
 * clamped to `minChance..maxChance`.
 */
export function computeTN(opts: {
  rules: AttributeRules;
  attribute: Attribute | null;
  attributeScore: number;
  attributeLabel?: string;
  gearBonus: number;
  specialisationMatched: boolean;
  specialisationLabel?: string;
}): TargetNumber {
  const rules = normalizeAttributeRules(opts.rules);
  const parts: TNPart[] = [];
  let tn = rules.baseChance;

  if (opts.attribute) {
    const amount = opts.attributeScore * rules.attributePoint;
    tn += amount;
    parts.push({ label: opts.attributeLabel ?? ATTRIBUTE_LABELS[opts.attribute], amount });
  }
  if (opts.gearBonus > 0 && opts.attribute) {
    const amount = opts.gearBonus * rules.attributePoint;
    tn += amount;
    parts.push({ label: "gear", amount });
  }
  if (opts.specialisationMatched) {
    tn += rules.specialisationBonus;
    parts.push({ label: `${opts.specialisationLabel ?? "specialisation"} specialisation`, amount: rules.specialisationBonus });
  }

  return { tn: Math.min(rules.maxChance, Math.max(rules.minChance, Math.round(tn))), parts };
}

export type RollBand = "strong" | "mixed" | "cost";

/**
 * Band a percentile roll against a Target Number (RPG_DESIGN.md → Outcome
 * bands): the margin scales with the TN itself, so a hard check and an easy
 * one both keep the same shape — Great/Mixed/Fail split proportionally to the
 * stated chance rather than by a fixed number of points.
 *
 * `marginSize = clamp(round(0.2 × TN), minMargin, TN − 1)`. Great = `roll ≤ TN
 * − marginSize`; Mixed = `TN − marginSize < roll ≤ TN`; Fail = `roll > TN` —
 * so Fail is always exactly `100 − TN`, by construction.
 */
export function bandForRoll(roll: number, tn: number, rules: AttributeRules): RollBand {
  const r = normalizeAttributeRules(rules);
  const clampedTn = Math.min(r.maxChance, Math.max(r.minChance, tn));
  const marginSize = Math.min(
    clampedTn - 1,
    Math.max(r.minMargin, Math.round((r.mixedMarginPct / 100) * clampedTn)),
  );
  if (roll > clampedTn) return "cost";
  if (roll > clampedTn - marginSize) return "mixed";
  return "strong";
}

/** The bands, spelled out — the "what would this have needed" line. */
export function bandScale(tn: number, rules: AttributeRules): string {
  const r = normalizeAttributeRules(rules);
  const clampedTn = Math.min(r.maxChance, Math.max(r.minChance, tn));
  const marginSize = Math.min(
    clampedTn - 1,
    Math.max(r.minMargin, Math.round((r.mixedMarginPct / 100) * clampedTn)),
  );
  const great = clampedTn - marginSize;
  const mixedLabel = marginSize <= 1 ? `${great + 1}` : `${great + 1}–${clampedTn}`;
  return `1–${great} great · ${mixedLabel} mixed · ${clampedTn + 1}–100 fail`;
}
