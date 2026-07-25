import { describe, it, expect } from "vitest";
import {
  allMembers,
  clearOverrides,
  dropEntry,
  getEntry,
  hasOverrides,
  mergeOverrides,
  partyCount,
  partyMembers,
  playerCharacter,
  presentMembers,
  resolve,
  setEntry,
} from "./roster";
import { defaultPC } from "./defaults";
import type { Character, RosterEntry } from "../types";

function member(id: string, name: string, patch: Partial<Character> = {}): Character {
  return {
    id,
    role: "member",
    name,
    species: "human",
    description: "plain",
    personality: "calm",
    drive: "wander",
    strengths: { name: "Tracking", description: "reads a trail" },
    equipment: [],
    ...patch,
  };
}

const entry = (id: string, patch: Partial<RosterEntry> = {}): RosterEntry => ({
  id,
  inParty: false,
  lastSpokeTurn: 0,
  status: "active",
  ...patch,
});

describe("getEntry / resolve", () => {
  it("defaults a character the adventure has never touched", () => {
    expect(getEntry([], "x")).toEqual({
      id: "x",
      inParty: false,
      lastSpokeTurn: 0,
      status: "active",
    });
  });

  it("folds overrides over the base character", () => {
    const base = member("a", "Ada");
    const resolved = resolve(base, entry("a", { inParty: true, overrides: { description: "scarred" } }));
    expect(resolved.description).toBe("scarred");
    // Untouched fields still come from the authored character.
    expect(resolved.personality).toBe("calm");
    expect(resolved.inParty).toBe(true);
  });

  it("resolves to defaults with no entry at all", () => {
    const resolved = resolve(member("a", "Ada"));
    expect(resolved).toMatchObject({ inParty: false, lastSpokeTurn: 0, status: "active" });
  });
});

describe("partyMembers", () => {
  const chars = [defaultPC(), member("a", "Ada"), member("b", "Bel")];

  it("returns only in-party members, in roster order", () => {
    const roster = [entry("b", { inParty: true }), entry("a", { inParty: true })];
    expect(partyMembers(chars, roster).map((m) => m.name)).toEqual(["Bel", "Ada"]);
  });

  it("excludes characters who are not in the party", () => {
    expect(partyMembers(chars, [entry("a")])).toEqual([]);
  });

  it("skips ids whose character was deleted from the library", () => {
    // A restored save slot can name someone the player has since deleted.
    const roster = [entry("a", { inParty: true }), entry("gone", { inParty: true })];
    expect(partyMembers(chars, roster).map((m) => m.id)).toEqual(["a"]);
  });

  it("never treats the PC as a party slot", () => {
    expect(partyMembers(chars, [entry("pc", { inParty: true })])).toEqual([]);
  });

  it("counts the party without resolving it", () => {
    expect(partyCount([entry("a", { inParty: true }), entry("b")])).toBe(1);
  });
});

describe("playerCharacter / presentMembers / allMembers", () => {
  const chars = [defaultPC(), member("a", "Ada"), member("b", "Bel")];

  it("resolves the PC against its own overrides", () => {
    const pc = playerCharacter(chars, [entry("pc", { overrides: { drive: "go home" } })]);
    expect(pc?.drive).toBe("go home");
  });

  it("presentMembers is the PC plus the party", () => {
    const names = presentMembers(chars, [entry("b", { inParty: true })]).map((c) => c.name);
    expect(names).toEqual(["Hiro", "Bel"]);
  });

  it("allMembers covers the whole library, party or not", () => {
    expect(allMembers(chars, []).map((c) => c.id)).toEqual(["pc", "a", "b"]);
  });
});

describe("setEntry", () => {
  it("appends an entry for a character with none", () => {
    const next = setEntry([], "a", { inParty: true });
    expect(next).toEqual([{ id: "a", inParty: true, lastSpokeTurn: 0, status: "active" }]);
  });

  it("patches an existing entry", () => {
    const next = setEntry([entry("a")], "a", { lastSpokeTurn: 7 });
    expect(next[0].lastSpokeTurn).toBe(7);
  });

  it("returns the SAME array when nothing changed", () => {
    // captureReversal reference-diffs the roster, so a no-op must not allocate.
    const roster = [entry("a", { inParty: true })];
    expect(setEntry(roster, "a", { inParty: true })).toBe(roster);
  });
});

describe("overrides", () => {
  it("merges without dropping earlier keys", () => {
    let roster = mergeOverrides([], "a", { description: "muddy" });
    roster = mergeOverrides(roster, "a", { drive: "revenge" });
    expect(getEntry(roster, "a").overrides).toEqual({ description: "muddy", drive: "revenge" });
    expect(hasOverrides(roster, "a")).toBe(true);
  });

  it("is a no-op for an empty patch", () => {
    const roster = [entry("a")];
    expect(mergeOverrides(roster, "a", {})).toBe(roster);
  });

  it("clears only the named keys — a player edit adopts just what they typed", () => {
    const roster = mergeOverrides([], "a", { description: "muddy", drive: "revenge" });
    const next = clearOverrides(roster, "a", ["description"]);
    expect(getEntry(next, "a").overrides).toEqual({ drive: "revenge" });
  });

  it("clears everything when no keys are named", () => {
    const roster = mergeOverrides([], "a", { description: "muddy" });
    const next = clearOverrides(roster, "a");
    expect(getEntry(next, "a").overrides).toBeUndefined();
    expect(hasOverrides(next, "a")).toBe(false);
  });

  it("drops the overrides key once the last override is cleared", () => {
    const roster = mergeOverrides([], "a", { description: "muddy" });
    const next = clearOverrides(roster, "a", ["description"]);
    expect(getEntry(next, "a").overrides).toBeUndefined();
  });

  it("returns the same array when there is nothing to clear", () => {
    const roster = [entry("a")];
    expect(clearOverrides(roster, "a")).toBe(roster);
  });
});

describe("dropEntry", () => {
  it("forgets a deleted character", () => {
    expect(dropEntry([entry("a"), entry("b")], "a").map((e) => e.id)).toEqual(["b"]);
  });

  it("returns the same array when the id is unknown", () => {
    const roster = [entry("a")];
    expect(dropEntry(roster, "zzz")).toBe(roster);
  });
});
