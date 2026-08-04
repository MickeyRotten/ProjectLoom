import { describe, expect, it } from "vitest";
import type { Character } from "../types";
import {
  MAX_ALIASES,
  findByName,
  formatAka,
  matchesName,
  nameForms,
  parseAliases,
  slug,
  withRename,
} from "./names";

function member(id: string, name: string, patch: Partial<Character> = {}): Character {
  return {
    id,
    role: "member",
    name,
    species: "",
    sex: "",
    description: "",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
    notes: "",
    equipment: [],
    ...patch,
  };
}

describe("slug", () => {
  it("folds case, punctuation and spacing", () => {
    expect(slug("  The Hooded Stranger! ")).toBe("the-hooded-stranger");
    expect(slug("Grik")).toBe(slug("grik"));
  });

  it("is empty for a name with nothing matchable in it", () => {
    expect(slug("   ")).toBe("");
    expect(slug("!!!")).toBe("");
  });
});

describe("nameForms", () => {
  it("puts the current name first and former ones newest-first behind it", () => {
    const c = member("m-1", "Vex", { aliases: ["Unnamed Goblin", "the Hooded Stranger"] });
    expect(nameForms(c)).toEqual(["Vex", "the Hooded Stranger", "Unnamed Goblin"]);
  });

  it("is just the name when nothing was renamed", () => {
    expect(nameForms(member("m-1", "Ada"))).toEqual(["Ada"]);
  });

  it("dedupes by slug — a differently-punctuated repeat is one form", () => {
    const c = member("m-1", "Vex", { aliases: ["vex!", "Grik"] });
    expect(nameForms(c)).toEqual(["Vex", "Grik"]);
  });

  it("survives a stored shape it never wrote", () => {
    const junk = { name: "Vex", aliases: "not an array" } as unknown as Character;
    expect(nameForms(junk)).toEqual(["Vex"]);
    const holes = { name: "Vex", aliases: [null, 7, " ", "Grik"] } as unknown as Character;
    expect(nameForms(holes)).toEqual(["Vex", "Grik"]);
  });
});

describe("matchesName / findByName", () => {
  const cast = [
    member("pc", "Hiro", { role: "pc" }),
    member("m-1", "Vex", { aliases: ["Unnamed Goblin"] }),
  ];

  it("matches the current name and every former one", () => {
    expect(matchesName(cast[1], "vex")).toBe(true);
    expect(matchesName(cast[1], "  Unnamed  Goblin ")).toBe(true);
    expect(matchesName(cast[1], "Grik")).toBe(false);
  });

  it("resolves an old name to the character who now carries a new one", () => {
    expect(findByName(cast, "Unnamed Goblin")?.id).toBe("m-1");
  });

  it("skips the PC when the caller wants members only", () => {
    expect(findByName(cast, "Hiro")?.id).toBe("pc");
    expect(findByName(cast, "Hiro", { members: true })).toBeUndefined();
  });

  it("resolves nobody for a name with nothing matchable in it", () => {
    expect(findByName(cast, "   ")).toBeUndefined();
  });
});

describe("withRename", () => {
  it("moves the old name onto the aliases", () => {
    const renamed = withRename(member("m-1", "Unnamed Goblin"), "Grik");
    expect(renamed.name).toBe("Grik");
    expect(renamed.aliases).toEqual(["Unnamed Goblin"]);
  });

  it("keeps the newest former name first", () => {
    const once = withRename(member("m-1", "the Hooded Stranger"), "Vex");
    const twice = withRename(once, "Vexara");
    expect(twice.aliases).toEqual(["Vex", "the Hooded Stranger"]);
  });

  it("returns the same object when the name did not really change", () => {
    const c = member("m-1", "Grik");
    expect(withRename(c, "grik ")).toBe(c);
    expect(withRename(c, "   ")).toBe(c);
  });

  it("never leaves a character aliased to their own name", () => {
    const there = withRename(member("m-1", "Grik"), "Vex");
    const back = withRename(there, "Grik");
    expect(back.name).toBe("Grik");
    expect(back.aliases).toEqual(["Vex"]);
  });

  it("keeps only the most recent MAX_ALIASES former names", () => {
    let c = member("m-1", "N0");
    for (let i = 1; i <= MAX_ALIASES + 2; i++) c = withRename(c, `N${i}`);
    expect(c.aliases).toHaveLength(MAX_ALIASES);
    expect(c.aliases?.[0]).toBe(`N${MAX_ALIASES + 1}`);
    expect(c.aliases).not.toContain("N0");
  });
});

describe("formatAka", () => {
  it("is blank for a character who was never renamed", () => {
    expect(formatAka(member("m-1", "Ada"))).toBe("");
  });

  it("quotes the former names, newest first", () => {
    const c = member("m-1", "Vex", { aliases: ["Unnamed Goblin", "the Stranger"] });
    expect(formatAka(c)).toBe('earlier "the Stranger", "Unnamed Goblin"');
  });

  it("caps what the prompt carries", () => {
    const c = member("m-1", "D", { aliases: ["A", "B", "C"] });
    expect(formatAka(c)).toBe('earlier "C", "B"');
  });
});

describe("parseAliases", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseAliases(" Grik ,, the Goblin , ")).toEqual(["Grik", "the Goblin"]);
  });

  it("drops one that repeats the character's own name", () => {
    expect(parseAliases("Vex, Grik", "vex")).toEqual(["Grik"]);
  });

  it("dedupes and caps the same way a rename does", () => {
    expect(parseAliases("A, a!, B, C, D, E")).toEqual(["A", "B", "C"]);
  });
});
