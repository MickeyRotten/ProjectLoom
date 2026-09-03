import type { Character, LoomBlock, Settings } from "../types";
import { type ChatMessage } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { findByName } from "./names";
import { completeChat } from "./openrouter";

/**
 * Op verification — the cheap second call (`Settings.cheapModelId`, default
 * gpt-oss 120b) that closes the gap `deltas.ts → reconcileBlock` leaves open.
 *
 * `reconcileBlock` is free and deterministic, but it only judges an op
 * against STATE — a restatement, a duplicate, an update to the count it
 * already is. It has no way to tell whether a genuinely NEW party member or
 * inventory item the narrator just claimed is actually supported by the
 * prose it just wrote, versus hallucinated straight into the structured
 * output. This runs AFTER `reconcileBlock`, so it only has to judge the ops
 * that survived the free filter — and it runs a second time, a cheap model
 * checking a specific claim against a short passage, rather than trusting
 * the same call that made the claim to also grade itself.
 *
 * Fail-open, like every side call in this app: a missing key, a timeout, an
 * aborted turn, or a reply that doesn't parse all mean nothing is vetoed —
 * exactly today's behaviour. The gate can only SUBTRACT ops the narrator
 * proposed; it never adds one, and a broken verifier must never be worse
 * than no verifier.
 */

/** Authoring at this cost would be worse than not checking at all. */
export const VERIFY_OPS_TEMPERATURE = 0.1;

export interface VerifyCandidate {
  kind: "party" | "inventory";
  /** Index into `block.party` / `block.inventory` — how a verdict maps back. */
  index: number;
  label: string;
  description?: string;
}

/**
 * The ops worth asking about — the two shapes the TODO item names: a NEW
 * character ("a new NPC") and a taken item ("add items, take items").
 *
 * A party `add` only counts when `findByName` resolves nobody: an `add`
 * naming someone already in the cast is a standing move, not a creation
 * (`deltas.ts → applyParty` already treats it that way), and `members: true`
 * matches the same restriction party ops use everywhere else — the PC is
 * never what a party delta creates. Every inventory `add` counts: it has
 * already survived `reconcileInventory`'s restatement/no-quantity fold, so
 * what remains is a claimed real pickup, which is exactly the claim worth
 * checking against the prose.
 *
 * Pure, no I/O — returns `[]` on the ordinary quiet turn, which is what lets
 * the async half below skip the network call entirely.
 */
export function pendingVerification(
  block: LoomBlock,
  characters: Character[],
): VerifyCandidate[] {
  const out: VerifyCandidate[] = [];

  (block.party ?? []).forEach((d, index) => {
    if (d.op !== "add") return;
    if (findByName(characters, d.name, { members: true })) return;
    out.push({ kind: "party", index, label: d.name, description: d.description });
  });

  (block.inventory ?? []).forEach((d, index) => {
    if (d.op !== "add") return;
    out.push({ kind: "inventory", index, label: d.label, description: d.description });
  });

  return out;
}

/**
 * The messages[] for one verify call: the numbered claims, then the prose
 * they're checked against. No scenario, no history, no sheets — the question
 * is narrow ("does this passage support this claim?"), and everything else
 * would be tokens spent teaching a cheap model a world it doesn't need to
 * understand to answer it.
 */
export function buildVerifyMessages(
  prose: string,
  candidates: VerifyCandidate[],
): ChatMessage[] {
  const rows = candidates.map((c, i) => {
    const what = c.kind === "party" ? "a NEW character introduced" : "an item TAKEN";
    const desc = c.description?.trim() ? ` — ${c.description.trim()}` : "";
    return `${i + 1}. [${what}] ${c.label}${desc}`;
  });

  return [
    {
      role: "system",
      content: [
        "OP CHECK — a narrator just wrote one beat of a text adventure. Its structured output claims the numbered things below happened in it.",
        'For EACH one, decide: does the prose below actually show or clearly imply it happening? A character merely mentioned, seen, or spoken about is not "introduced". An item merely seen, offered as an option, or belonging to someone else is not "taken" — only an item the prose shows the player actually acquiring counts.',
        'Reply with a single JSON object and nothing else — no prose, no code fences: {"results":[{"index":1,"supported":true}, ...]}, one entry per numbered claim, in any order.',
      ].join("\n"),
    },
    { role: "system", content: `CLAIMS\n${rows.join("\n")}` },
    { role: "user", content: `PROSE\n${prose.trim()}\n\nEmit the JSON object now.` },
  ];
}

/**
 * The reply, parsed tolerantly like every other side call. Defaults every
 * entry to `true` (supported) up front, so a reply that is missing,
 * unparseable, or only partially covers the claims vetoes nothing beyond
 * what it explicitly said `false` to — fail-open per-entry, not just
 * per-call.
 */
export function parseVerifyResult(raw: string, count: number): boolean[] {
  const verdicts = new Array<boolean>(count).fill(true);

  const json = extractFirstJsonObject(raw);
  if (!json) return verdicts;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  const results = parsed && Array.isArray(parsed.results) ? parsed.results : null;
  if (!results) return verdicts;

  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const index = typeof r.index === "number" ? Math.trunc(r.index) - 1 : NaN;
    if (index < 0 || index >= count) continue;
    if (typeof r.supported === "boolean") verdicts[index] = r.supported;
  }

  return verdicts;
}

/**
 * Drop the vetoed rows. Pure and reference-stable, like `reconcileBlock`: a
 * block with nothing to drop is returned as-is.
 */
export function applyVerification(
  block: LoomBlock,
  candidates: VerifyCandidate[],
  verdicts: boolean[],
): LoomBlock {
  const dropParty = new Set<number>();
  const dropInventory = new Set<number>();
  candidates.forEach((c, i) => {
    if (verdicts[i]) return;
    if (c.kind === "party") dropParty.add(c.index);
    else dropInventory.add(c.index);
  });

  if (!dropParty.size && !dropInventory.size) return block;

  const next = { ...block };
  if (dropParty.size && block.party) {
    next.party = block.party.filter((_, i) => !dropParty.has(i));
  }
  if (dropInventory.size && block.inventory) {
    next.inventory = block.inventory.filter((_, i) => !dropInventory.has(i));
  }
  return next;
}

export interface VerifyOpsOptions {
  settings: Settings;
  /** This turn's narration — the passage every claim is checked against. */
  prose: string;
  characters: Character[];
  /** The block AFTER `reconcileBlock` — what the store is about to apply. */
  block: LoomBlock;
  signal?: AbortSignal;
}

/**
 * The network half. Skips the call entirely when there is nothing to ask
 * about (the ordinary turn), and fails open on anything else — a bad key, a
 * timeout, the player pressing Stop mid-check, or a reply that doesn't parse
 * all return the block unchanged rather than throw, because a broken checker
 * must never be worse than no checker.
 */
export async function verifyOps(opts: VerifyOpsOptions): Promise<LoomBlock> {
  const { settings, prose, characters, block, signal } = opts;
  const candidates = pendingVerification(block, characters);
  if (!candidates.length) return block;

  try {
    const raw = await completeChat({
      settings,
      model: settings.cheapModelId.trim() || settings.textModelId,
      messages: buildVerifyMessages(prose, candidates),
      signal,
      temperature: VERIFY_OPS_TEMPERATURE,
    });
    const verdicts = parseVerifyResult(raw, candidates.length);
    return applyVerification(block, candidates, verdicts);
  } catch {
    return block;
  }
}
