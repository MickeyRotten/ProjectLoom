import { describe, it, expect } from "vitest";
import {
  computeSpotlightSignals,
  detectSpeakers,
  formatSpotlightBlock,
  isDirectlyAddressed,
  memberSpoke,
  segmentDialogue,
  extractKeywords,
} from "./spotlight";
import type { Character } from "../types";

function member(patch: Partial<Character> & { id: string; name: string }): Character {
  return {
    role: "member",
    species: "human",
    description: "",
    personality: "",
    drive: "",
    likes: "",
    dislikes: "",
    fieldSkill: { name: "", description: "" },
    equipment: [],
    lastSpokeTurn: 0,
    inParty: true,
    ...patch,
  };
}

const navi = member({
  id: "m-navi",
  name: "Navi",
  fieldSkill: { name: "Lockpicking", description: "Opens any lock, door, or mechanism." },
});
const riley = member({ id: "m-riley", name: "Riley Vance" });

describe("isDirectlyAddressed", () => {
  it("matches a bare first-name mention, case-insensitive, word-bounded", () => {
    expect(isDirectlyAddressed("navi, get the door", "Navi")).toBe(true);
    expect(isDirectlyAddressed("the NAVIgator drifts", "Navi")).toBe(false);
  });

  it("matches the first token of a full name", () => {
    expect(isDirectlyAddressed("Riley, cover me", "Riley Vance")).toBe(true);
  });

  it("group address is a hard override for everyone", () => {
    expect(isDirectlyAddressed("everyone hold position", "Navi")).toBe(true);
    expect(isDirectlyAddressed("we push forward", "Riley Vance")).toBe(true);
  });
});

describe("extractKeywords", () => {
  it("drops short words and stopwords, keeps content words", () => {
    const kw = extractKeywords("The door is locked and the mechanism jams");
    expect(kw.has("door")).toBe(true);
    expect(kw.has("locked")).toBe(true);
    expect(kw.has("mechanism")).toBe(true);
    expect(kw.has("the")).toBe(false);
    expect(kw.has("is")).toBe(false);
  });

  it("keeps explicitly-kept short tokens", () => {
    const kw = extractKeywords("the map lies open", ["map"]);
    expect(kw.has("map")).toBe(true);
  });
});

describe("computeSpotlightSignals", () => {
  it("flags field-skill relevance from message + context keyword overlap", () => {
    const [s] = computeSpotlightSignals("can you pick this lock", "", [navi], 5);
    expect(s.fieldSkillRelevant).toBe(true);
  });

  it("relevance can come from recent context, not just the message", () => {
    const [s] = computeSpotlightSignals("hurry", "the mechanism clicks behind the door", [navi], 5);
    expect(s.fieldSkillRelevant).toBe(true);
  });

  it("no overlap ⇒ not relevant", () => {
    const [s] = computeSpotlightSignals("the sky burns red", "wind and dust", [navi], 5);
    expect(s.fieldSkillRelevant).toBe(false);
  });

  it("turnsSinceLastSpoke = currentTurn − lastSpokeTurn, floored at 0", () => {
    const spoken = member({ id: "m-x", name: "X", lastSpokeTurn: 3 });
    const [s] = computeSpotlightSignals("", "", [spoken], 7);
    expect(s.turnsSinceLastSpoke).toBe(4);
    const [s2] = computeSpotlightSignals("", "", [spoken], 2);
    expect(s2.turnsSinceLastSpoke).toBe(0);
  });
});

describe("formatSpotlightBlock", () => {
  it("emits one line per member and the rule", () => {
    const signals = computeSpotlightSignals("navi open the lock", "", [navi, riley], 4);
    const block = formatSpotlightBlock(signals, "Default to silence.");
    expect(block).toContain("PARTY SPOTLIGHT — THIS TURN");
    expect(block).toContain("Navi: addressed=yes · skill-relevant=yes");
    expect(block).toContain("Riley Vance: addressed=no");
    expect(block).toContain("RULE: Default to silence.");
  });

  it("returns empty string with no party", () => {
    expect(formatSpotlightBlock([], "rule")).toBe("");
  });
});

describe("memberSpoke / detectSpeakers", () => {
  it("counts the Name: \"…\" convention", () => {
    expect(memberSpoke('Navi: "Watch the treeline."', "Navi")).toBe(true);
  });

  it("counts name-then-said and said-then-name attribution", () => {
    expect(memberSpoke("Navi grinned and said nothing useful", "Navi")).toBe(true);
    expect(memberSpoke('"Down!" whispered Navi', "Navi")).toBe(true);
  });

  it("counts a quote-close then name attribution", () => {
    expect(memberSpoke('"Hold," Navi warned.', "Navi")).toBe(true);
  });

  it("does NOT count a bare mention", () => {
    expect(memberSpoke("Navi was asleep against the wall.", "Navi")).toBe(false);
    expect(memberSpoke("You think of Navi and press on.", "Navi")).toBe(false);
  });

  it("detectSpeakers returns ids only for members with an attributed line", () => {
    const text = 'Navi: "Left path." You glance at Riley Vance, who only nods.';
    const ids = detectSpeakers(text, [navi, riley]);
    expect(ids).toContain("m-navi");
    // Riley is only mentioned, no line attributed → not a speaker.
    expect(ids).not.toContain("m-riley");
  });
});

describe("segmentDialogue", () => {
  it("splits prose and attributed dialogue by the Name: \"…\" convention", () => {
    const segs = segmentDialogue('The door groans. Navi: "It\'s open." You step through.', [navi]);
    expect(segs).toEqual([
      { speaker: null, text: "The door groans. " },
      { speaker: "Navi", text: "It's open." },
      { speaker: null, text: " You step through." },
    ]);
  });

  it("resolves a first-token match to the canonical full name", () => {
    const segs = segmentDialogue('Riley: "On it."', [riley]);
    expect(segs).toEqual([{ speaker: "Riley Vance", text: "On it." }]);
  });

  it("returns a single prose segment when there is no dialogue", () => {
    expect(segmentDialogue("Just wind and dust.", [navi])).toEqual([
      { speaker: null, text: "Just wind and dust." },
    ]);
  });

  it("no party ⇒ whole text is prose", () => {
    expect(segmentDialogue("Anything.", [])).toEqual([{ speaker: null, text: "Anything." }]);
  });
});
