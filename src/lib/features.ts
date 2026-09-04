import type { FeatureFlags, LoomBlock } from "../types";

/**
 * Narrator feature flags (DESIGN.md → Narrator features) — which subsystems the
 * narrator drives, and the one filter that enforces the answer on a parsed
 * block.
 *
 * Three things have to agree for a feature to be OFF, and this module owns the
 * third:
 *
 *  1. `prompt.ts` does not build the block that states the fact.
 *  2. `prompt.ts` does not document the channel in the output protocol.
 *  3. `filterBlock` strips the channel out of whatever came back anyway.
 *
 * (3) is not belt-and-braces. The history window is full of turns from before
 * the switch was thrown, and a model reads its own past output as the example
 * of what a turn looks like: for several turns after `quests` goes off, quest
 * ops keep arriving. Without the filter they would apply — and, worse, be
 * RECORDED on the beat, where `toasts.ts` turns them into chips and reversal
 * replays them forever.
 *
 * Pure and reference-stable, like `deltas.ts → reconcileBlock` beside which it
 * runs: a block with nothing to strip is returned as-is.
 */

/** Every flag, in the order the Features screen lists them. */
export const FEATURE_KEYS = [
  "options",
  "characters",
  "spotlight",
  "gear",
  "conditions",
  "inventory",
  "quests",
  "notes",
  "places",
  "location",
  "weather",
  "clock",
  "journal",
  "stakes",
  "opVerification",
  "trackCoords",
] as const satisfies readonly (keyof FeatureFlags)[];

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Every flag set the same way. `allFeatures(false)` is the pure-prose narrator —
 * the state Features' **All Off** puts the game in.
 */
export function allFeatures(on: boolean): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const key of FEATURE_KEYS) out[key] = on;
  return out;
}

/** Everything on — the shipped state, and the fallback for any caller with no settings. */
export function defaultFeatures(): FeatureFlags {
  return {
    options: true,
    characters: true,
    spotlight: true,
    gear: true,
    conditions: true,
    inventory: true,
    quests: true,
    notes: true,
    places: true,
    location: true,
    weather: true,
    clock: true,
    journal: true,
    stakes: true,
    opVerification: true,
    trackCoords: true,
  };
}

/**
 * The flags as they arrive from storage, in the shape the app can use.
 *
 * Sanitized at READ, like `normalizeDice`: a stored
 * blob may be missing (every build before this one), partial (a build before the
 * newest flag), or hold anything at all under a key. A missing flag reads as ON,
 * which is what makes adding a fifteenth feature a non-event for every saved
 * settings document in the world.
 *
 * `legacy` carries the three flags that used to be flat `Settings` keys —
 * `showActionOptions`, `journalEnabled`, `stakesEnabled`. They are read once,
 * here, so a player who switched one off keeps it off across the upgrade.
 */
export function normalizeFeatures(
  raw: unknown,
  legacy: LegacyFeatureSettings = {},
): FeatureFlags {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<FeatureKey, unknown>
  >;
  const legacyFor: Partial<Record<FeatureKey, boolean | undefined>> = {
    options: legacy.showActionOptions,
    journal: legacy.journalEnabled,
    stakes: legacy.stakesEnabled,
  };

  const out = defaultFeatures();
  for (const key of FEATURE_KEYS) {
    const value = stored[key];
    // The stored flag wins; the retired flat key is the fallback; ON is the
    // fallback's fallback. Only a literal `false` switches anything off, so a
    // corrupt value can never silently disable half the game.
    if (typeof value === "boolean") out[key] = value;
    else if (typeof legacyFor[key] === "boolean") out[key] = legacyFor[key] as boolean;
  }

  return out;
}

/** The retired flat `Settings` keys `normalizeFeatures` still reads. */
export interface LegacyFeatureSettings {
  showActionOptions?: boolean;
  journalEnabled?: boolean;
  stakesEnabled?: boolean;
}

/**
 * The features that own a `<<<LOOM>>>` channel — everything the narrator can
 * write, as opposed to what it is merely shown or what the client decides on its
 * own (`journal`, `gear`, `stakes`).
 *
 * Kept beside `filterBlock`, which is the only other place that knows this list,
 * so a fifteenth channel cannot be added to one and forgotten in the other.
 */
const BLOCK_CHANNELS = [
  "options",
  "characters",
  "spotlight",
  "conditions",
  "inventory",
  "quests",
  "notes",
  "places",
  "location",
  "weather",
  "clock",
] as const satisfies readonly FeatureKey[];

/**
 * Whether the block can still carry anything at all.
 *
 * With every channel off the block is `{}` on every turn, and a turn that came
 * back without one has lost NOTHING — so the repair call that would otherwise
 * buy the missing block back (`loomBlock.ts → needsBlockRepair`) is a request
 * spent on an empty object.
 */
export function writesBlock(features: FeatureFlags): boolean {
  return BLOCK_CHANNELS.some((key) => features[key]);
}

/**
 * Strip every `<<<LOOM>>>` channel the narrator is no longer allowed to use.
 *
 * Runs on the parsed block BEFORE `reconcileBlock` → `applyDeltas`, so a
 * disabled channel is not applied, not recorded on the beat, and therefore not
 * chipped by `toasts.ts` or replayed by reversal.
 *
 * What it cannot express is the clock: `duration` absent still ages the world by
 * the default step (deliberately — an unparseable turn must not freeze time), so
 * `applyDeltas` takes the flags too and holds the clock still itself.
 */
export function filterBlock(block: LoomBlock, features: FeatureFlags): LoomBlock {
  const drop: (keyof LoomBlock)[] = [];

  if (!features.options) drop.push("options");
  if (!features.characters) drop.push("party");
  if (!features.spotlight) drop.push("spoke");
  if (!features.conditions) drop.push("conditions");
  if (!features.inventory) drop.push("inventory");
  if (!features.quests) drop.push("quests");
  if (!features.notes) drop.push("notes");
  if (!features.places) drop.push("area");
  if (!features.location) drop.push("location");
  if (!features.weather) drop.push("weather");
  // `day` rides along with the clock: it is the retired field the narrator used
  // to set directly, still readable out of old recorded blocks.
  if (!features.clock) drop.push("duration", "day");

  const present = drop.filter((key) => block[key] !== undefined);
  if (!present.length) return block;

  const next = { ...block };
  for (const key of present) delete next[key];
  return next;
}
