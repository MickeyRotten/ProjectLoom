import { describe, it, expect } from "vitest";
import { NPC_LIMIT, formatNpcBlock, matchNpcs } from "./cast";
import type { PartyMember } from "../types";

function npc(name: string, patch: Partial<PartyMember> = {}): PartyMember {
  return {
    id: `m-${name.toLowerCase().replace(/\s+/g, "-")}`,
    role: "member",
    name,
    species: "human",
    sex: "female",
    description: "weathered",
    personality: "Blunt.",
    drive: "Keep the forge lit.",
    strengths: "Smithing — reforges anything",
    flaws: "Short-tempered with fools.",
    equipment: [],
    lastSpokeTurn: 0,
    standing: "npc",
    condition: "",
    ...patch,
  };
}

describe("matchNpcs", () => {
  const mira = npc("Mira Aldgate");
  const bram = npc("Bram");
  const cast = [mira, bram];

  it("matches a full name", () => {
    expect(matchNpcs(cast, "we ask Mira Aldgate for help").map((n) => n.name)).toEqual([
      "Mira Aldgate",
    ]);
  });

  it("matches a single name token", () => {
    expect(matchNpcs(cast, "ask Mira about the blade").map((n) => n.name)).toEqual([
      "Mira Aldgate",
    ]);
    expect(matchNpcs(cast, "find Aldgate").map((n) => n.name)).toEqual(["Mira Aldgate"]);
  });

  it("is case-insensitive and word-bounded", () => {
    expect(matchNpcs(cast, "MIRA waves")).toHaveLength(1);
    // "admiral" contains no standalone "mira"; a substring must not match.
    expect(matchNpcs(cast, "the admiral salutes")).toEqual([]);
  });

  it("returns nothing for an empty scan", () => {
    expect(matchNpcs(cast, "   ")).toEqual([]);
  });

  it("keeps roster order and caps the count", () => {
    const many = Array.from({ length: NPC_LIMIT + 2 }, (_, i) => npc(`Name${i}`));
    const text = many.map((n) => n.name).join(" ");
    const matched = matchNpcs(many, text);
    expect(matched).toHaveLength(NPC_LIMIT);
    expect(matched[0].name).toBe("Name0");
  });

  it("ignores name tokens too short to stand alone", () => {
    // "Al" would otherwise hit every "al" in the prose.
    expect(matchNpcs([npc("Al Ferrow")], "the metal gate")).toEqual([]);
  });
});

describe("formatNpcBlock", () => {
  it("is empty when nobody matched, so no block is injected", () => {
    expect(formatNpcBlock([])).toBe("");
  });

  it("carries the sheet and forbids walking them alongside the player", () => {
    const block = formatNpcBlock([npc("Mira Aldgate")]);
    expect(block).toContain("KNOWN CHARACTERS");
    expect(block).toContain("- Mira Aldgate (human, female) — weathered");
    expect(block).toContain("Personality: Blunt.");
    expect(block).toContain("Drive: Keep the forge lit.");
    expect(block).toContain("Strengths: Smithing — reforges anything");
    expect(block).toContain("Flaws: Short-tempered with fools.");
    expect(block).toContain("never write them as travelling with the player");
  });

  it("omits blank fields rather than printing empty labels", () => {
    const block = formatNpcBlock([
      npc("Bram", { personality: "", drive: "", strengths: "", flaws: "" }),
    ]);
    expect(block).not.toContain("Personality:");
    expect(block).not.toContain("Drive:");
    expect(block).not.toContain("Strengths");
    expect(block).not.toContain("Flaws");
  });
});
