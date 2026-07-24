import { describe, it, expect } from "vitest";
import { buildMessages, buildHistory, approxTokens, formatPartyRoster } from "./prompt";
import { newGame, defaultSettings } from "./defaults";
import type { Character, GameState, Message } from "../types";

const settings = defaultSettings();

function narr(turn: number, content: string): Message {
  return { id: `n${turn}`, role: "narrator", content, turn };
}
function play(turn: number, content: string): Message {
  return { id: `p${turn}`, role: "player", content, turn };
}

function member(patch: Partial<Character> & { id: string; name: string }): Character {
  return {
    role: "member", species: "human", description: "", personality: "", drive: "",
    likes: "", dislikes: "", fieldSkill: { name: "", description: "" }, equipment: [],
    lastSpokeTurn: 0, inParty: true, ...patch,
  };
}

describe("buildMessages — ordering", () => {
  it("starts with a system context and ends with the player's new message", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "I head north." });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("SCENARIO");
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "I head north." });
  });

  it("puts the output-protocol system message after history, before the new message", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "go" });
    const protocolIdx = msgs.findIndex((m) => m.content.includes("<<<LOOM>>>"));
    const userIdx = msgs.length - 1;
    expect(protocolIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBe(userIdx - 1);
    expect(msgs[protocolIdx].role).toBe("system");
  });

  it("includes PC summary and inventory in the system context", () => {
    const g = newGame();
    g.inventory = [{ label: "Compass", description: "spins", quantity: 2 }];
    const msgs = buildMessages({ settings, game: g, playerMessage: "go" });
    expect(msgs[0].content).toContain("PLAYER CHARACTER");
    expect(msgs[0].content).toContain("Compass ×2");
  });

  it("includes PC personality/likes/dislikes in the system context", () => {
    const g = newGame();
    const pc = g.characters.find((c) => c.role === "pc")!;
    pc.personality = "Stoic, dry-witted.";
    pc.likes = "Maps";
    pc.dislikes = "Crowds";
    const msgs = buildMessages({ settings, game: g, playerMessage: "go" });
    expect(msgs[0].content).toContain("Personality: Stoic, dry-witted.");
    expect(msgs[0].content).toContain("Likes: Maps");
    expect(msgs[0].content).toContain("Dislikes: Crowds");
  });
});

describe("party roster + spotlight", () => {
  const navi = member({
    id: "m-navi", name: "Navi", species: "sprite", description: "a darting spark",
    fieldSkill: { name: "Lockpicking", description: "opens any lock" },
  });

  it("includes the party roster in the system context", () => {
    const g = newGame();
    g.characters = [...g.characters, navi];
    const msgs = buildMessages({ settings, game: g, playerMessage: "go" });
    expect(msgs[0].content).toContain("PARTY — in your company");
    expect(msgs[0].content).toContain("Navi (sprite)");
    expect(msgs[0].content).toContain("Field Skill — Lockpicking");
  });

  it("injects a spotlight block after the system context, before history", () => {
    const g = newGame();
    g.characters = [...g.characters, navi];
    const msgs = buildMessages({ settings, game: g, playerMessage: "navi, open it" });
    const spotIdx = msgs.findIndex((m) => m.content.includes("PARTY SPOTLIGHT — THIS TURN"));
    expect(spotIdx).toBe(1);
    expect(msgs[spotIdx].content).toContain("Navi: addressed=yes");
  });

  it("omits roster + spotlight when the party is empty", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "go" });
    expect(msgs.some((m) => m.content.includes("PARTY SPOTLIGHT"))).toBe(false);
    expect(msgs[0].content).not.toContain("PARTY — in your company");
  });

  it("benched members are excluded from the roster", () => {
    const g = newGame();
    g.characters = [...g.characters, { ...navi, inParty: false }];
    expect(formatPartyRoster(g.characters.filter((c) => c.role === "member" && c.inParty))).toBe("");
  });
});

describe("world notes injection", () => {
  it("injects matched notes as a system block before the spotlight/history", () => {
    const g = newGame();
    g.worldNotes = [
      { id: "n1", title: "The Old Well", keywords: ["well"], content: "the last working well" },
    ];
    const msgs = buildMessages({ settings, game: g, playerMessage: "I search for the well" });
    const idx = msgs.findIndex((m) => m.content.includes("WORLD NOTES"));
    expect(idx).toBe(1); // right after the system context
    expect(msgs[idx].content).toContain("The Old Well: the last working well");
  });

  it("omits the block when no note matches the scan text", () => {
    const g = newGame();
    g.worldNotes = [{ id: "n1", title: "The Old Well", keywords: ["well"], content: "x" }];
    const msgs = buildMessages({ settings, game: g, playerMessage: "I climb the ridge" });
    expect(msgs.some((m) => m.content.includes("WORLD NOTES"))).toBe(false);
  });

  it("matches keywords against recent beats, not just the new message", () => {
    const g = newGame();
    g.worldNotes = [{ id: "n1", title: "Ash Cult", keywords: ["ashers"], content: "zealots" }];
    g.messages = [narr(1, "The ashers block the gate.")];
    const msgs = buildMessages({ settings, game: g, playerMessage: "I step forward" });
    expect(msgs.some((m) => m.content.includes("WORLD NOTES"))).toBe(true);
  });
});

describe("output protocol — action options toggle", () => {
  it("asks for options by default", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain('"options": array of 3–4 action strings');
  });

  it("tells the model to omit options when disabled", () => {
    const off = { ...settings, showActionOptions: false };
    const msgs = buildMessages({ settings: off, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain("OMIT this field entirely");
    expect(proto.content).not.toContain('"options": array of 3–4 action strings');
  });
});

describe("relevant gear injection", () => {
  it("injects a gear block when an equipped item's keywords surface in the message", () => {
    const g = newGame();
    const msgs = buildMessages({
      settings,
      game: g,
      playerMessage: "I dig through my leather satchel",
    });
    const idx = msgs.findIndex((m) => m.content.includes("RELEVANT GEAR — THIS TURN"));
    expect(idx).toBeGreaterThan(0);
    expect(msgs[idx].role).toBe("system");
    expect(msgs[idx].content).toContain(
      "Hiro — Leather Satchel: Worn leather satchel for carrying supplies.",
    );
  });

  it("omits the block when no equipped item is relevant", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "I wave hello" });
    expect(msgs.some((m) => m.content.includes("RELEVANT GEAR"))).toBe(false);
  });

  it("covers in-party members' gear, matched from recent beats too", () => {
    const g = newGame();
    g.characters = [
      ...g.characters,
      member({
        id: "m-pack",
        name: "Pack Rat",
        equipment: [{ label: "Lantern", description: "Casts a warm ring of light in the dark." }],
      }),
    ];
    g.messages = [narr(1, "The tunnel ahead is pitch dark.")];
    const msgs = buildMessages({ settings, game: g, playerMessage: "I press on" });
    const block = msgs.find((m) => m.content.includes("RELEVANT GEAR — THIS TURN"));
    expect(block?.content).toContain("Pack Rat — Lantern");
  });

  it("benched members' gear never rides along", () => {
    const g = newGame();
    // Strip PC gear so only the benched member's lantern could match.
    g.characters = [
      { ...g.characters[0], equipment: [] },
      member({
        id: "m-pack",
        name: "Pack Rat",
        inParty: false,
        equipment: [{ label: "Lantern", description: "light in the dark" }],
      }),
    ];
    const msgs = buildMessages({ settings, game: g, playerMessage: "I raise the lantern" });
    expect(msgs.some((m) => m.content.includes("RELEVANT GEAR"))).toBe(false);
  });
});

describe("output protocol — gold", () => {
  it("tells the model Gold is permanent and adjusted via update with a new total", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain("Gold is the permanent currency item");
    expect(proto.content).toContain('"label": "Gold"');
    expect(proto.content).toContain("never remove it");
  });
});

describe("output protocol — quest status", () => {
  it("tells the model quests carry a status so it can mark them done", () => {
    const msgs = buildMessages({ settings, game: newGame(), playerMessage: "go" });
    const proto = msgs.find((m) => m.content.includes("OUTPUT PROTOCOL"))!;
    expect(proto.content).toContain('"status": "active"|"done"');
    expect(proto.content).toContain('status "done" when the player completes it');
  });
});

describe("buildHistory", () => {
  it("prepends the opening narration as the first assistant turn", () => {
    const g = newGame();
    g.messages = [play(1, "hi"), narr(1, "you see a door")];
    const hist = buildHistory(g, 3000);
    expect(hist[0]).toEqual({ role: "assistant", content: g.scenario.openingNarration });
    expect(hist[1]).toEqual({ role: "user", content: "hi" });
    expect(hist[2]).toEqual({ role: "assistant", content: "you see a door" });
  });

  it("maps player→user and narrator→assistant", () => {
    const g = newGame();
    g.messages = [play(1, "a"), narr(1, "b")];
    const hist = buildHistory(g, 3000);
    expect(hist.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("trims oldest turns to the budget but always keeps the opening", () => {
    const g: GameState = newGame();
    const big = "x".repeat(4000); // ~1000 tokens each
    g.messages = [narr(1, big), narr(2, big), narr(3, big)];
    const hist = buildHistory(g, 1500); // opening + ~one big turn
    expect(hist[0].content).toBe(g.scenario.openingNarration);
    // Only the most recent turn(s) fit.
    expect(hist).toContainEqual({ role: "assistant", content: big });
    const bigCount = hist.filter((m) => m.content === big).length;
    expect(bigCount).toBeLessThan(3);
    expect(bigCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps the newest beat even when it alone exceeds the budget", () => {
    const g = newGame();
    const huge = "z".repeat(40000); // ~10k tokens, far over any budget below
    g.messages = [narr(1, "older"), narr(2, huge)];
    const hist = buildHistory(g, 500);
    // The opening is always present; the newest beat survives regardless.
    expect(hist[0].content).toBe(g.scenario.openingNarration);
    expect(hist.some((m) => m.content === huge)).toBe(true);
    // The over-budget newest beat still crowds out the older one.
    expect(hist.some((m) => m.content === "older")).toBe(false);
  });

  it("keeps the newest turn, dropping older ones first", () => {
    const g = newGame();
    g.messages = [narr(1, "OLD".repeat(1000)), narr(2, "NEW")];
    const hist = buildHistory(g, approxTokens(g.scenario.openingNarration) + 5);
    expect(hist.some((m) => m.content === "NEW")).toBe(true);
    expect(hist.some((m) => m.content.startsWith("OLD"))).toBe(false);
  });
});
