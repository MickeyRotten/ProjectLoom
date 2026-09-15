import { ATTRIBUTES } from "../types";
import type { Attribute, IntentVerdict, Settings, Specialisation } from "../types";
import type { ChatMessage } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { completeChat } from "./openrouter";

/**
 * The intent classifier (RPG_DESIGN.md → The intent classifier) — replaces
 * `isRisky`/`RISK_KEYWORDS`'s keyword gate entirely.
 *
 * Keyword matching is a surface match, not a semantic one: "I sneak a glance
 * at the note" trips a risk gate on the word "sneak" alone, with no actual
 * gamble in the sentence. This is a separate, cold, non-roleplay side call —
 * the same shape as `verifyOps.ts` — run on `Settings.cheapModelId`, because
 * asking the NARRATOR's own model "was that risky?" as part of its turn is
 * the appeasement bug wearing a different hat: a model under narration
 * incentive, asked whether to invite a check that might make it say no to its
 * own player, will simply say no.
 *
 * "Risky" covers two shapes of gamble: an attempt that could go wrong (a
 * fight, a climb, a lie) and an attempt to find, notice, or understand
 * something that might not be there — a deliberate search, investigation, or
 * close read of someone/something, where the character might come up empty,
 * miss the hidden thing, or draw the wrong conclusion. A passive "I look
 * around" stays free either way; the second shape only fires on a stated,
 * specific attempt.
 *
 * Scope is deliberately tight, matching how every other side call in this app
 * reads only what it needs: the action text, one line of scene context, and
 * the ACTING character's own Specialisation list (a handful of entries) —
 * never the whole global catalog, never the beats.
 *
 * Fail-open, like every side call here: a missing key, a timeout, an aborted
 * turn, or a reply that doesn't parse all resolve to `{ risky: false,
 * attribute: null, specialisation: null }` — no roll, no block, the narrator
 * free-forms exactly as a genuinely non-risky turn does today.
 *
 * Non-deterministic by nature (an LLM call, unlike the roll itself), so
 * `store.ts` caches the verdict on the turn's `Message` and
 * `regenerateLastTurn` replays it rather than reclassifying — classify once
 * per turn, replay forever after, the same discipline the roll's seed
 * already has.
 */

export const INTENT_TEMPERATURE = 0.1;

export const NEUTRAL_VERDICT: IntentVerdict = { risky: false, attribute: null, specialisation: null };

function isAttribute(v: unknown): v is Attribute {
  return (ATTRIBUTES as readonly string[]).includes(v as string);
}

/** The scoped specialisation list handed to the classifier — id/label/attribute, nothing else. */
export interface ScopedSpecialisation {
  id: string;
  label: string;
  attribute: Attribute;
}

/** An acting character's held catalog rows, resolved for the prompt. */
export function scopeSpecialisations(
  heldIds: string[],
  catalog: Specialisation[],
): ScopedSpecialisation[] {
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const out: ScopedSpecialisation[] = [];
  for (const id of heldIds) {
    const s = byId.get(id);
    if (s) out.push({ id: s.id, label: s.label, attribute: s.attribute });
  }
  return out;
}

/**
 * The messages[] for one classify call. No scenario, no history, no full
 * cast — the question is narrow ("is this a gamble, and on what"), and
 * everything else would be tokens spent teaching a cheap model a world it
 * doesn't need to judge one sentence.
 */
export function buildIntentMessages(
  action: string,
  sceneContext: string,
  specialisations: ScopedSpecialisation[],
): ChatMessage[] {
  const specLines = specialisations.length
    ? specialisations.map((s) => `- ${s.id}: ${s.label} (${s.attribute})`).join("\n")
    : "(none)";

  return [
    {
      role: "system",
      content: [
        "INTENT CHECK — a text adventure needs to know, on device, whether the player's next action is a GAMBLE that could fail.",
        "Risky covers TWO shapes of gamble, both genuine attempts at something that might not go the player's way:",
        "1. An attempt that could go wrong: a fight, a climb, a lie, a haggle, a lockpick, a leap.",
        "2. An attempt to FIND, NOTICE, or UNDERSTAND something that might not be there to find: searching a room or a body for anything hidden, digging through a desk or a ledger, reading a stranger's face for a tell, appraising whether something is genuine, piecing together what a clue means, listening for what isn't being said. These fail quietly — nothing is missed on-page, only in the world — but they are still an attempt with a real chance of coming up empty, wrong, or incomplete.",
        "NOT risky: a plain look around with no specific target ('I look around', 'I look at the room'), waiting, talking without pressing for anything, moving somewhere safe, or glancing at / looking at something already in plain view with nothing to miss. A verb that SOUNDS dramatic but names no real attempt (\"I sneak a glance at the note\" — no one is trying to avoid detection, and nothing about the note is hidden) is NOT risky either; judge the actual attempt, not the vocabulary.",
        "The line between the two: 'I examine the chest' (open-ended, no stated goal — describe what's there, not risky) vs. 'I check the chest for a false bottom' (a specific attempt to find something that may not be there — risky). 'I look at the merchant' (not risky) vs. 'I watch the merchant for any sign he's lying' (risky).",
        "If risky, name the ONE Attribute the attempt leans on hardest: might (physical force, endurance), agility (speed, precision, reflex), mind (knowledge, perception, tactics — noticing what's hidden, gleaning insight from a search or a clue), or presence (force of personality, social read).",
        "If risky, also check whether the attempt matches ONE of the character's held Specialisations below closely enough that it should apply — at most one, and only a close match, never a stretch.",
        "Examples:",
        '- "I attack the bandit" → risky, might',
        '- "I look around the room" → not risky (no specific target, nothing to miss)',
        '- "I sneak a glance at the note" → not risky (no attempt at anything, and nothing on the note is hidden)',
        '- "I search the desk for a hidden compartment" → risky, mind',
        '- "I read the merchant\'s face for a tell" → risky, mind or presence, whichever fits the scene',
        '- "I ask her about the village" → not risky (talk without pressing for anything hidden)',
        'Reply with a single JSON object and nothing else — no prose, no code fences: {"risky": true|false, "attribute": "might"|"agility"|"mind"|"presence"|null, "specialisation": "<id>"|null}.',
      ].join("\n"),
    },
    {
      role: "system",
      content: `SCENE\n${sceneContext.trim() || "(no scene context)"}\n\nHELD SPECIALISATIONS\n${specLines}`,
    },
    { role: "user", content: `ACTION\n${action.trim()}\n\nEmit the JSON object now.` },
  ];
}

/**
 * The reply, parsed tolerantly like every other side call. Anything
 * unreadable, or naming an attribute/specialisation outside the closed lists
 * this call was actually given, falls back to the neutral verdict for that
 * field — fail-open per-field, not just per-call.
 */
export function parseIntentVerdict(raw: string, specialisations: ScopedSpecialisation[]): IntentVerdict {
  const json = extractFirstJsonObject(raw);
  if (!json) return NEUTRAL_VERDICT;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return NEUTRAL_VERDICT;

  const risky = parsed.risky === true;
  if (!risky) return NEUTRAL_VERDICT;

  const attribute = isAttribute(parsed.attribute) ? parsed.attribute : null;
  const specId = typeof parsed.specialisation === "string" ? parsed.specialisation : null;
  const specialisation = specId && specialisations.some((s) => s.id === specId) ? specId : null;

  return { risky: true, attribute, specialisation };
}

export interface ClassifyIntentOptions {
  settings: Settings;
  action: string;
  sceneContext: string;
  /** The acting character's own held Specialisation ids (own + granted by gear). */
  heldSpecialisationIds: string[];
  signal?: AbortSignal;
}

/**
 * The network half. Fails open on anything — a bad key, a timeout, the
 * player pressing Stop mid-check, or a reply that doesn't parse all return
 * the neutral verdict rather than throw: a broken classifier must never be
 * worse than no classifier, and an ordinary turn should never be blocked
 * waiting on it to succeed.
 */
export async function classifyIntent(opts: ClassifyIntentOptions): Promise<IntentVerdict> {
  const { settings, action, sceneContext, heldSpecialisationIds, signal } = opts;
  if (!action.trim()) return NEUTRAL_VERDICT;

  const scoped = scopeSpecialisations(heldSpecialisationIds, settings.specialisations);
  try {
    const raw = await completeChat({
      settings,
      model: settings.cheapModelId.trim() || settings.textModelId,
      messages: buildIntentMessages(action, sceneContext, scoped),
      signal,
      temperature: INTENT_TEMPERATURE,
    });
    return parseIntentVerdict(raw, scoped);
  } catch {
    return NEUTRAL_VERDICT;
  }
}
