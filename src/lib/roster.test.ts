import { describe, it, expect } from "vitest";
import {
  PARTY_LIMIT,
  activeMembers,
  allMembers,
  benchedMembers,
  clearOverrides,
  dropEntry,
  formatIdentity,
  getEntry,
  hasOverrides,
  isInParty,
  mergeOverrides,
  normalizeEntry,
  strengthsText,
  normalizeRoster,
  npcMembers,
  partedMembers,
  partyCount,
  partyFull,
  partyMembers,
  pruneRoster,
  playerCharacter,
  presentMembers,
  resolve,
  setEntry,
  setStanding,
  standingOf,
} from "./roster";
import { defaultPC } from "./defaults";
import type { Character, RosterEntry } from "../types";

function member(id: string, name: string, patch: Partial<Character> = {}): Character {
  return {
    id,
    role: "member",
    name,
    species: "human",
    sex: "",
    description: "plain",
    personality: "calm",
    drive: "wander",
    strengths: "Tracking — reads a trail",
    flaws: "Trusts nobody",
    notes: "",
    equipment: [],
    ...patch,
  };
}

const entry = (id: string, patch: Partial<RosterEntry> = {}): RosterEntry => ({
  id,
  standing: "none",
  lastSpokeTurn: 0,
  ...patch,
});

describe("getEntry / resolve", () => {
  it("defaults a character the adventure has never touched", () => {
    expect(getEntry([], "x")).toEqual({ id: "x", standing: "none", lastSpokeTurn: 0 });
  });

  it("folds overrides over the base character", () => {
    const base = member("a", "Ada");
    const resolved = resolve(base, entry("a", { standing: "active", overrides: { description: "scarred" } }));
    expect(resolved.description).toBe("scarred");
    // Untouched fields still come from the authored character.
    expect(resolved.personality).toBe("calm");
    expect(resolved.standing).toBe("active");
  });

  it("resolves to defaults with no entry at all", () => {
    const resolved = resolve(member("a", "Ada"));
    expect(resolved).toMatchObject({ standing: "none", lastSpokeTurn: 0 });
  });
});

describe("partyMembers / activeMembers / benchedMembers / npcMembers", () => {
  const chars = [defaultPC(), member("a", "Ada"), member("b", "Bel")];

  it("returns only in-party members, in roster order", () => {
    const roster = [entry("b", { standing: "active" }), entry("a", { standing: "active" })];
    expect(partyMembers(chars, roster).map((m) => m.name)).toEqual(["Bel", "Ada"]);
  });

  it("excludes characters who are not in the party", () => {
    expect(partyMembers(chars, [entry("a")])).toEqual([]);
  });

  it("counts a benched member as party, but never as present", () => {
    const roster = [entry("a", { standing: "active" }), entry("b", { standing: "benched" })];
    expect(partyMembers(chars, roster).map((m) => m.name)).toEqual(["Ada", "Bel"]);
    expect(activeMembers(chars, roster).map((m) => m.name)).toEqual(["Ada"]);
    expect(benchedMembers(chars, roster).map((m) => m.name)).toEqual(["Bel"]);
    expect(presentMembers(chars, roster).map((m) => m.name)).toEqual(["Hiro", "Ada"]);
  });

  it("keeps NPCs out of the party entirely", () => {
    const roster = [entry("a", { standing: "npc" })];
    expect(partyMembers(chars, roster)).toEqual([]);
    expect(partedMembers(chars, roster)).toEqual([]);
    expect(npcMembers(chars, roster).map((m) => m.name)).toEqual(["Ada"]);
  });

  it("skips ids whose character was deleted from the library", () => {
    // A restored save slot can name someone the player has since deleted.
    const roster = [entry("a", { standing: "active" }), entry("gone", { standing: "active" })];
    expect(partyMembers(chars, roster).map((m) => m.id)).toEqual(["a"]);
  });

  it("never treats the PC as a party slot", () => {
    expect(partyMembers(chars, [entry("pc", { standing: "active" })])).toEqual([]);
  });

  it("counts only in-party members", () => {
    expect(partyCount(chars, [entry("a", { standing: "active" }), entry("b")])).toBe(1);
  });

  it("counts the scene, not the bench — the bench is uncapped", () => {
    const roster = [
      entry("a", { standing: "active" }),
      entry("b", { standing: "benched" }),
      entry("x", { standing: "benched" }),
      entry("y", { standing: "benched" }),
    ];
    expect(partyCount(chars, roster)).toBe(1);
    expect(partyFull(chars, roster)).toBe(false);
  });

  it("never counts an entry the library can no longer resolve", () => {
    // Undo restores a pre-turn roster snapshot taken before the player deleted
    // someone; the leftover entry must not hold a slot nothing can fill.
    const roster = [entry("a", { standing: "active" }), entry("gone", { standing: "active" })];
    expect(partyCount(chars, roster)).toBe(1);
    expect(partyCount(chars, roster)).toBe(partyMembers(chars, roster).length);
  });

  it("never counts the PC as a party slot", () => {
    expect(partyCount(chars, [entry("pc", { standing: "active" })])).toBe(0);
  });

  it("is full only at PARTY_LIMIT resolvable members", () => {
    const ghosts = Array.from({ length: PARTY_LIMIT }, (_, i) =>
      entry(`ghost-${i}`, { standing: "active" }),
    );
    expect(partyFull(chars, ghosts)).toBe(false);
  });
});

describe("partedMembers", () => {
  const chars = [defaultPC(), member("a", "Ada"), member("b", "Bel")];

  it("returns non-active members who are no longer travelling, in roster order", () => {
    const roster = [
      entry("b", { standing: "fallen" }),
      entry("a", { standing: "departed" }),
    ];
    expect(partedMembers(chars, roster).map((m) => [m.name, m.standing])).toEqual([
      ["Bel", "fallen"],
      ["Ada", "departed"],
    ]);
  });

  it("excludes anyone still in the party — active or benched", () => {
    // A rejoined member is with you again; nothing 'lost' about them, and a
    // benched member is still one of yours.
    expect(partedMembers(chars, [entry("a", { standing: "active" })])).toEqual([]);
    expect(partedMembers(chars, [entry("a", { standing: "benched" })])).toEqual([]);
  });

  it("excludes characters the adventure simply never recruited", () => {
    expect(partedMembers(chars, [entry("a")])).toEqual([]);
  });

  it("skips ids whose character was deleted from the library", () => {
    expect(partedMembers(chars, [entry("gone", { standing: "departed" })])).toEqual([]);
  });
});

describe("pruneRoster", () => {
  const chars = [defaultPC(), member("a", "Ada")];

  it("drops entries whose character the library no longer has", () => {
    const roster = [entry("a", { standing: "active" }), entry("gone", { standing: "active" })];
    expect(pruneRoster(chars, roster).map((e) => e.id)).toEqual(["a"]);
  });

  it("returns the same reference when every entry still resolves", () => {
    const roster = [entry("a", { standing: "active" }), entry("pc")];
    expect(pruneRoster(chars, roster)).toBe(roster);
  });
});

describe("playerCharacter / presentMembers / allMembers", () => {
  const chars = [defaultPC(), member("a", "Ada"), member("b", "Bel")];

  it("resolves the PC against its own overrides", () => {
    const pc = playerCharacter(chars, [entry("pc", { overrides: { drive: "go home" } })]);
    expect(pc?.drive).toBe("go home");
  });

  it("presentMembers is the PC plus the party", () => {
    const names = presentMembers(chars, [entry("b", { standing: "active" })]).map((c) => c.name);
    expect(names).toEqual(["Hiro", "Bel"]);
  });

  it("allMembers covers the whole library, party or not", () => {
    expect(allMembers(chars, []).map((c) => c.id)).toEqual(["pc", "a", "b"]);
  });
});

describe("normalizeEntry / normalizeRoster", () => {
  it("reads the pre-ladder inParty + status pair", () => {
    expect(normalizeEntry({ id: "a", inParty: true, lastSpokeTurn: 3, status: "active" })).toEqual({
      id: "a",
      standing: "active",
      lastSpokeTurn: 3,
    });
  });

  it("keeps how someone left when they were out of the party", () => {
    expect(normalizeEntry({ id: "a", inParty: false, status: "fallen" }).standing).toBe("fallen");
    expect(normalizeEntry({ id: "a", inParty: false, status: "departed" }).standing).toBe(
      "departed",
    );
  });

  it("maps the old nowhere-state — out of the party, still 'active' — to none", () => {
    // What an over-cap join used to write: in no prompt block and no screen.
    expect(normalizeEntry({ id: "a", inParty: false, status: "active" }).standing).toBe("none");
  });

  it("carries overrides through untouched", () => {
    const overrides = { description: "muddy" };
    expect(normalizeEntry({ id: "a", inParty: true, overrides }).overrides).toBe(overrides);
  });

  it("folds a legacy labelled strengths override into one line", () => {
    const overrides = { strengths: { name: "Tracking", description: "reads a trail" } };
    const entry = normalizeEntry({
      id: "a",
      standing: "active",
      overrides: overrides as never,
    });
    expect(entry.overrides).toEqual({ strengths: "Tracking — reads a trail" });
  });

  it("returns the SAME array when every entry is already current", () => {
    // Loading a modern save must not look like a change to captureReversal.
    const roster = [entry("a", { standing: "active" }), entry("b")];
    expect(normalizeRoster(roster)).toBe(roster);
  });

  it("rewrites a roster carrying legacy entries", () => {
    const roster = normalizeRoster([{ id: "a", inParty: true, lastSpokeTurn: 2, status: "active" }]);
    expect(roster).toEqual([{ id: "a", standing: "active", lastSpokeTurn: 2 }]);
  });
});

describe("standings", () => {
  it("counts active and benched as in the party, nothing else", () => {
    expect(isInParty("active")).toBe(true);
    expect(isInParty("benched")).toBe(true);
    for (const s of ["none", "npc", "departed", "fallen"] as const) {
      expect(isInParty(s)).toBe(false);
    }
  });

  it("reads a standing straight off the roster, defaulting to none", () => {
    const roster = [entry("a", { standing: "benched" })];
    expect(standingOf(roster, "a")).toBe("benched");
    expect(standingOf(roster, "nobody")).toBe("none");
  });

  it("setStanding moves a member without touching anything else", () => {
    const roster = [entry("a", { standing: "active", lastSpokeTurn: 4 })];
    expect(setStanding(roster, "a", "benched")[0]).toEqual({
      id: "a",
      standing: "benched",
      lastSpokeTurn: 4,
    });
  });
});

describe("setEntry", () => {
  it("appends an entry for a character with none", () => {
    const next = setEntry([], "a", { standing: "active" });
    expect(next).toEqual([{ id: "a", standing: "active", lastSpokeTurn: 0 }]);
  });

  it("patches an existing entry", () => {
    const next = setEntry([entry("a")], "a", { lastSpokeTurn: 7 });
    expect(next[0].lastSpokeTurn).toBe(7);
  });

  it("returns the SAME array when nothing changed", () => {
    // captureReversal reference-diffs the roster, so a no-op must not allocate.
    const roster = [entry("a", { standing: "active" })];
    expect(setEntry(roster, "a", { standing: "active" })).toBe(roster);
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

describe("formatIdentity", () => {
  it("names species and sex together", () => {
    expect(formatIdentity({ name: "Elara", species: "elf", sex: "female" })).toBe(
      "Elara (elf, female)",
    );
  });

  it("drops whichever trait is blank", () => {
    expect(formatIdentity({ name: "Elara", species: "elf", sex: "  " })).toBe("Elara (elf)");
    expect(formatIdentity({ name: "Elara", species: "", sex: "female" })).toBe("Elara (female)");
    expect(formatIdentity({ name: "Elara", species: "", sex: "" })).toBe("Elara");
  });

  it("names an unnamed character rather than emitting an empty line", () => {
    expect(formatIdentity({ name: "  ", species: "elf", sex: "" })).toBe("(unnamed) (elf)");
  });

  it("carries former names, so the model can connect the history to the sheet", () => {
    expect(
      formatIdentity({ name: "Grik", species: "goblin", sex: "male", aliases: ["Unnamed Goblin"] }),
    ).toBe('Grik (goblin, male, earlier "Unnamed Goblin")');
    // …and still reads cleanly with no traits to lead with.
    expect(formatIdentity({ name: "Grik", species: "", sex: "", aliases: ["the Stranger"] })).toBe(
      'Grik (earlier "the Stranger")',
    );
  });

  it("tolerates a stored character with no sex at all", () => {
    const legacy = { name: "Elara", species: "elf" } as { name: string; species: string; sex: string };
    expect(formatIdentity(legacy)).toBe("Elara (elf)");
  });
});

describe("strengthsText", () => {
  it("passes a string through unchanged", () => {
    expect(strengthsText("Lockpicking — opens anything")).toBe("Lockpicking — opens anything");
  });

  it("joins a legacy { name, description } pair with a dash", () => {
    expect(strengthsText({ name: "Tracking", description: "reads a trail" })).toBe(
      "Tracking — reads a trail",
    );
  });

  it("uses whichever half of a legacy pair is filled in", () => {
    expect(strengthsText({ name: "Tracking", description: "" })).toBe("Tracking");
    expect(strengthsText({ name: "", description: "reads a trail" })).toBe("reads a trail");
  });

  it("reads anything else as blank", () => {
    expect(strengthsText(undefined)).toBe("");
    expect(strengthsText(null)).toBe("");
    expect(strengthsText(7)).toBe("");
  });
});
