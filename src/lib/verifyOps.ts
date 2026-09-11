import type { Character, LoomBlock, PartyDelta, Settings } from "../types";
import { type ChatMessage } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { findByName, slug } from "./names";
import { completeChat } from "./openrouter";

/**
 * Op verification — the cheap second call (`Settings.cheapModelId`, default
 * gpt-oss 120b) that closes the gap `deltas.ts → reconcileBlock` leaves open.
 *
 * `reconcileBlock` is free and deterministic, but it only judges an op
 * against STATE — a restatement, a duplicate, an update to the count it
 * already is. It has no way to tell whether a claim the narrator just made is
 * actually supported by the prose it just wrote, versus hallucinated straight
 * into the structured output. Four such claims exist, and all four are rules
 * the OUTPUT PROTOCOL states in prose but nothing upstream checks:
 *  - `create`  — a party `add` naming somebody not already in the cast. The
 *    protocol says "add nobody the player can't yet call something"; a model
 *    that invents a name (or a placeholder) ahead of the scene breaks it
 *    silently, since `reconcileBlock` only sees a well-formed new character.
 *  - `rename`  — a `newName` landing on somebody already found. The protocol
 *    says a rename is for when "the name lands" — a `newName` the prose never
 *    actually gives the player is the same slip, one beat later.
 *  - `exit`    — a `remove` op resolving to `fallen` or `departed` for
 *    somebody already found. `npc`/`none` exits are left unchecked: those are
 *    a standing change, not an irreversible story beat worth vetoing over.
 *  - `taken`   — an inventory `add`, unchanged from before this widened
 *    beyond party ops.
 *
 * This runs AFTER `reconcileBlock`, so it only has to judge the ops that
 * survived the free filter — and it runs a second time, a cheap model
 * checking specific claims against a short passage, rather than trusting the
 * same call that made the claims to also grade itself.
 *
 * Fail-open, like every side call in this app: a missing key, a timeout, an
 * aborted turn, or a reply that doesn't parse all mean nothing is vetoed —
 * exactly today's behaviour. The gate can only SUBTRACT — it drops a whole op
 * for `create`/`exit`/`taken`, or just the `newName` field for `rename` (the
 * rest of that op, if any, still applies) — it never adds or rewrites
 * anything, and a broken verifier must never be worse than no verifier.
 */

/** Authoring at this cost would be worse than not checking at all. */
export const VERIFY_OPS_TEMPERATURE = 0.1;

export type VerifyClaim = "create" | "rename" | "exit" | "taken";

export interface VerifyCandidate {
  kind: "party" | "inventory";
  claim: VerifyClaim;
  /** Index into `block.party` / `block.inventory` — how a verdict maps back. */
  index: number;
  label: string;
  description?: string;
}

/**
 * The claims worth asking about. Pure, no I/O — returns `[]` on the ordinary
 * quiet turn, which is what lets the async half below skip the network call
 * entirely.
 *
 * `characters` is the cast BEFORE this turn's ops apply, same as
 * `reconcileBlock` reads — a party op's `name` is always "who they have been
 * called so far", so a rename or exit resolves against who was there a
 * moment ago, not who the op is about to make them.
 */
export function pendingVerification(
  block: LoomBlock,
  characters: Character[],
): VerifyCandidate[] {
  const out: VerifyCandidate[] = [];

  (block.party ?? []).forEach((d, index) => {
    if (!d?.name) return;
    const found = findByName(characters, d.name, { members: true });

    if (d.op === "add" && !found) {
      out.push({ kind: "party", claim: "create", index, label: d.name, description: d.description });
    }

    const newName = (d.newName ?? "").trim();
    if (found && newName && slug(newName) !== slug(found.name)) {
      out.push({ kind: "party", claim: "rename", index, label: newName });
    }

    if (d.op === "remove" && found) {
      const exit = resolvedExit(d);
      if (exit) out.push({ kind: "party", claim: "exit", index, label: found.name, description: exit });
    }
  });

  (block.inventory ?? []).forEach((d, index) => {
    if (d.op !== "add") return;
    out.push({ kind: "inventory", claim: "taken", index, label: d.label, description: d.description });
  });

  return out;
}

/**
 * The `remove` standings worth checking — `fallen` (death) and `departed`
 * (the default, and the explicit "left the story" mark). `npc`/`none` are
 * standing changes the narrator makes routinely (stepping back to an ally,
 * or a player-driven Kick replayed through this same op shape) and are left
 * unchecked, matching this gate's narrow, high-confidence scope.
 */
function resolvedExit(d: PartyDelta): "fallen" | "departed" | null {
  const said = d.standing ?? d.status;
  if (said === "npc" || said === "none") return null;
  return said === "fallen" ? "fallen" : "departed";
}

const CLAIM_TEXT: Record<VerifyClaim, string> = {
  create: "a NEW character introduced",
  rename: "a character renamed",
  exit: "a character's death or departure",
  taken: "an item TAKEN",
};

const CLAIM_RULES: Record<VerifyClaim, string> = {
  create:
    'A character merely mentioned, seen, or spoken about is not "introduced" — the prose must give the ' +
    "player an actual, particular person to have just met, not a placeholder or a name invented ahead of the scene.",
  rename:
    "The prose must actually use the new name, or clearly have the player learn it, THIS beat — a rename with " +
    "no textual basis is a name the player was never told.",
  exit:
    "The prose must clearly show this happening THIS beat — a character merely leaving the room, staying " +
    "behind, or being fine at the end does not count as dying or departing the story.",
  taken:
    'An item merely seen, offered as an option, or belonging to someone else is not "taken" — only an item ' +
    "the prose shows the player actually acquiring counts.",
};

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
    const desc = c.description?.trim() ? ` — ${c.description.trim()}` : "";
    return `${i + 1}. [${CLAIM_TEXT[c.claim]}] ${c.label}${desc}`;
  });
  const claimsAsked = new Set(candidates.map((c) => c.claim));
  const rules = [...claimsAsked].map((claim) => `- [${CLAIM_TEXT[claim]}]: ${CLAIM_RULES[claim]}`);

  return [
    {
      role: "system",
      content: [
        "OP CHECK — a narrator just wrote one beat of a text adventure. Its structured output claims the numbered things below happened in it.",
        "For EACH one, decide: does the prose below actually show or clearly imply it happening?",
        ...rules,
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

function omitNewName(d: PartyDelta): PartyDelta {
  const next = { ...d };
  delete next.newName;
  return next;
}

/**
 * Drop the vetoed rows. Pure and reference-stable, like `reconcileBlock`: a
 * block with nothing to drop is returned as-is. `create`/`exit` (party) and
 * `taken` (inventory) drop the whole op; `rename` only clears `newName`,
 * since the rest of that same op — a standing change riding alongside it —
 * made no unsupported claim and still applies.
 */
export function applyVerification(
  block: LoomBlock,
  candidates: VerifyCandidate[],
  verdicts: boolean[],
): LoomBlock {
  const dropParty = new Set<number>();
  const dropInventory = new Set<number>();
  const stripNewName = new Set<number>();

  candidates.forEach((c, i) => {
    if (verdicts[i]) return;
    if (c.kind === "inventory") {
      dropInventory.add(c.index);
    } else if (c.claim === "rename") {
      stripNewName.add(c.index);
    } else {
      dropParty.add(c.index);
    }
  });

  if (!dropParty.size && !dropInventory.size && !stripNewName.size) return block;

  const next = { ...block };
  if (block.party && (dropParty.size || stripNewName.size)) {
    next.party = block.party
      .map((d, i) => (stripNewName.has(i) ? omitNewName(d) : d))
      .filter((_, i) => !dropParty.has(i));
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
