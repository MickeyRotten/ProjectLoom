import { describe, it, expect } from "vitest";
import {
  MAX_OPTIONS,
  extractLastJsonObject,
  extractProseOptions,
  mergeRepairBlock,
  needsBlockRepair,
  normalizeOptions,
  parseLoomResponse,
  truncateForDisplay,
} from "./loomBlock";
import { defaultSettings } from "./defaults";

describe("truncateForDisplay", () => {
  it("shows everything before the first <<<", () => {
    expect(truncateForDisplay("You walk on.\n\n<<<LOOM>>>\n{")).toBe("You walk on.");
  });

  it("passes prose through untouched when no marker yet", () => {
    expect(truncateForDisplay("You wa")).toBe("You wa");
  });

  it("truncates at a partial marker mid-stream", () => {
    expect(truncateForDisplay("Done. <<")).toBe("Done.");
  });
});

describe("parseLoomResponse", () => {
  const wire = `The wind bites.

<<<LOOM>>>
{
  "location": "The Dusty Path",
  "day": 37,
  "weather": "windy",
  "options": ["Approach the ruins", "Signal the party", "Scan the treeline"]
}
<<<END>>>`;

  it("splits prose from block and parses fields", () => {
    const { prose, block } = parseLoomResponse(wire);
    expect(prose).toBe("The wind bites.");
    expect(block?.location).toBe("The Dusty Path");
    expect(block?.day).toBe(37);
    expect(block?.options).toEqual([
      "Approach the ruins",
      "Signal the party",
      "Scan the treeline",
    ]);
  });

  it("never leaks a malformed block into prose", () => {
    const raw = "You freeze.\n\n<<<LOOM>>>\n{ this is not json ))) ";
    const { prose, block } = parseLoomResponse(raw);
    expect(prose).toBe("You freeze.");
    expect(prose).not.toContain("<<<");
    expect(block).toBeNull();
  });

  it("salvages trailing commas", () => {
    const raw = 'Ok.\n<<<LOOM>>>\n{ "day": 3, "options": ["go",], }\n<<<END>>>';
    const { block } = parseLoomResponse(raw);
    expect(block?.day).toBe(3);
    expect(block?.options).toEqual(["go"]);
  });

  it("salvages a truncated (unbalanced) block by closing braces", () => {
    const raw = 'Ok.\n<<<LOOM>>>\n{ "location": "Cave", "day": 2';
    const { prose, block } = parseLoomResponse(raw);
    expect(prose).toBe("Ok.");
    expect(block?.location).toBe("Cave");
    expect(block?.day).toBe(2);
  });

  it("returns null block and full prose when there is no block", () => {
    const { prose, block } = parseLoomResponse("Just narration, no block.");
    expect(prose).toBe("Just narration, no block.");
    expect(block).toBeNull();
  });

  it("ignores braces inside strings when brace-matching", () => {
    const raw = 'Hi.\n<<<LOOM>>>\n{ "weather": "a {curly} day" }\n<<<END>>>';
    const { block } = parseLoomResponse(raw);
    expect(block?.weather).toBe("a {curly} day");
  });
});

/**
 * Failure mode B — the block is there, the marker isn't (or isn't spelled the
 * way it was asked for). Every case here used to lose the whole block, and the
 * marker-less ones ALSO rendered the raw JSON into the reading pane as prose.
 */
describe("parseLoomResponse — mangled and missing markers", () => {
  it("accepts a spaced, lowercase or short marker", () => {
    for (const marker of ["<<< LOOM >>>", "<<<loom>>>", "<<LOOM>>", "<LOOM>", "[LOOM]"]) {
      const { prose, block } = parseLoomResponse(`You walk on.\n\n${marker}\n{ "day": 4 }`);
      expect(block?.day, marker).toBe(4);
      expect(prose, marker).toBe("You walk on.");
    }
  });

  it("reads a fenced block with no marker at all, and keeps it out of the prose", () => {
    const raw = 'You walk on.\n\n```json\n{ "location": "Cave", "options": ["Go in"] }\n```';
    const { prose, block } = parseLoomResponse(raw);
    expect(block?.location).toBe("Cave");
    expect(prose).toBe("You walk on.");
    expect(prose).not.toContain("{");
    expect(prose).not.toContain("```");
  });

  it("reads a bare object at the end of the response", () => {
    const { prose, block } = parseLoomResponse('The door gives.\n{ "duration": "moment" }');
    expect(block?.duration).toBe("moment");
    expect(prose).toBe("The door gives.");
  });

  it("takes the LAST object when the model emitted more than one", () => {
    const raw = 'Ok.\n{ "day": 1 }\nSorry, again:\n{ "day": 2, "weather": "clear" }';
    expect(parseLoomResponse(raw).block?.day).toBe(2);
  });

  it("leaves prose braces as prose", () => {
    const raw = "She writes {a sigil} in the dust, then a second {mark}.";
    const { prose, block } = parseLoomResponse(raw);
    expect(block).toBeNull();
    expect(prose).toBe(raw);
  });

  it("does not cut the beat at a marker-shaped phrase in the prose", () => {
    const raw = 'The [loom] of fate turns.\n\n<<<LOOM>>>\n{ "day": 9 }\n<<<END>>>';
    const { prose, block } = parseLoomResponse(raw);
    expect(prose).toBe("The [loom] of fate turns.");
    expect(block?.day).toBe(9);
  });

  it("still cuts the prose at a marker whose JSON is unsalvageable", () => {
    const { prose, block } = parseLoomResponse("You freeze.\n<<<LOOM>>>\noptions: go, wait");
    expect(prose).toBe("You freeze.");
    expect(block).toBeNull();
  });
});

describe("extractLastJsonObject", () => {
  it("returns the last TOP-LEVEL object, not the last inner one", () => {
    const found = extractLastJsonObject('a { "x": 1 } b { "y": { "z": 2 } }');
    expect(found?.json).toBe('{ "y": { "z": 2 } }');
    expect(found?.start).toBe(15);
  });

  it("prefers a truncated trailing object to an earlier complete one", () => {
    const found = extractLastJsonObject('{ "a": 1 } then { "b": 2');
    expect(found?.json).toBe('{ "b": 2}');
  });

  it("ignores a stray closing brace", () => {
    expect(extractLastJsonObject("} nothing opened")).toBeNull();
  });

  it("returns null when there is no object", () => {
    expect(extractLastJsonObject("no braces here")).toBeNull();
  });
});

/**
 * Failure mode D — `options` present, shape wrong. `LoomBlock.options?: string[]`
 * was never checked, and an array of objects reaches the option button as a
 * React child and throws, taking the reading area down with it.
 */
describe("normalizeOptions", () => {
  it("passes a well-formed array through", () => {
    expect(normalizeOptions(["Go north", "Wait"])).toEqual(["Go north", "Wait"]);
  });

  it("splits one newline-separated string", () => {
    expect(normalizeOptions("Go north\nWait\nListen")).toEqual([
      "Go north",
      "Wait",
      "Listen",
    ]);
  });

  it("strips numbering the model wrote itself", () => {
    expect(normalizeOptions(["1. Go north", "2) Wait", "- Listen", "• Hide"])).toEqual([
      "Go north",
      "Wait",
      "Listen",
      "Hide",
    ]);
  });

  it("splits self-numbered options that arrived on one line", () => {
    expect(normalizeOptions("1. Go north 2. Wait 3. Listen")).toEqual([
      "Go north",
      "Wait",
      "Listen",
    ]);
  });

  it("reads the text out of option objects", () => {
    expect(
      normalizeOptions([{ action: "Go north" }, { label: "Wait" }, { text: "Listen" }]),
    ).toEqual(["Go north", "Wait", "Listen"]);
  });

  it("takes an object's only string when no known key names it", () => {
    expect(normalizeOptions([{ whatever: "Go north" }])).toEqual(["Go north"]);
    expect(normalizeOptions([{ a: "Go north", b: "or wait" }])).toEqual([]);
  });

  it("reads a numbered map", () => {
    expect(normalizeOptions({ "1": "Go north", "2": "Wait" })).toEqual(["Go north", "Wait"]);
  });

  it("strips wrapping bold and quotes", () => {
    expect(normalizeOptions(["**Go north**", '"Wait"'])).toEqual(["Go north", "Wait"]);
  });

  it("drops blanks, junk and case-insensitive repeats", () => {
    expect(normalizeOptions(["Go north", "", null, 42, "GO NORTH", true])).toEqual([
      "Go north",
      "42",
    ]);
  });

  it("caps the list", () => {
    const many = ["a", "b", "c", "d", "e", "f"];
    expect(normalizeOptions(many)).toHaveLength(MAX_OPTIONS);
  });

  it("is empty for anything unreadable", () => {
    expect(normalizeOptions(undefined)).toEqual([]);
    expect(normalizeOptions(7)).toEqual([]);
  });
});

describe("parseLoomResponse — options normalization", () => {
  it("normalizes a wrong-shaped options field in place", () => {
    const raw = 'Ok.\n<<<LOOM>>>\n{ "options": [{ "action": "Go north" }, "2. Wait" ] }';
    expect(parseLoomResponse(raw).block?.options).toEqual(["Go north", "Wait"]);
  });

  it("reads options the model filed under another name", () => {
    for (const key of ["actions", "choices", "suggestions", "next_actions"]) {
      const raw = `Ok.\n<<<LOOM>>>\n{ "${key}": ["Go north"] }`;
      const block = parseLoomResponse(raw).block;
      expect(block?.options, key).toEqual(["Go north"]);
      expect(block, key).not.toHaveProperty(key);
    }
  });

  it("empties an options field that held nothing usable", () => {
    const raw = 'Ok.\n<<<LOOM>>>\n{ "options": "" }';
    expect(parseLoomResponse(raw).block?.options).toEqual([]);
  });

  it("leaves a block that never mentioned options alone", () => {
    const raw = 'Ok.\n<<<LOOM>>>\n{ "day": 3 }';
    expect(parseLoomResponse(raw).block).not.toHaveProperty("options");
  });
});

/**
 * Failure mode C — the options were written, into the prose. Left there they
 * cost the player the buttons AND put a list in the middle of the story, which
 * the model then reads back as an example of what a beat looks like.
 */
describe("extractProseOptions", () => {
  it("lifts a trailing numbered list and strips it from the prose", () => {
    const found = extractProseOptions("The wind bites.\n\n1. Approach\n2. Wait\n3. Retreat");
    expect(found?.options).toEqual(["Approach", "Wait", "Retreat"]);
    expect(found?.prose).toBe("The wind bites.");
  });

  it("absorbs the line that introduced the list", () => {
    const found = extractProseOptions("The wind bites.\n\nWhat do you do?\n\n- Wait\n- Run");
    expect(found?.options).toEqual(["Wait", "Run"]);
    expect(found?.prose).toBe("The wind bites.");
  });

  it("ignores a single trailing bullet", () => {
    expect(extractProseOptions("You see a note.\n\n- it is signed")).toBeNull();
  });

  it("ignores prose with no trailing list", () => {
    expect(extractProseOptions("You walk on. The road bends north.")).toBeNull();
  });

  it("ignores a list of long narration lines", () => {
    const long = `- ${"a sentence that keeps going and going and going".repeat(3)}`;
    expect(extractProseOptions(`Ok.\n\n${long}\n${long}`)).toBeNull();
  });

  it("keeps the prose when the beat is nothing but the list", () => {
    const found = extractProseOptions("1. Approach\n2. Wait");
    expect(found?.options).toEqual(["Approach", "Wait"]);
    expect(found?.prose).toBe("1. Approach\n2. Wait");
  });

  it("only reads the tail — a mid-beat list stays prose", () => {
    const raw = "She lists them:\n- salt\n- iron\nThen she closes the ledger.";
    expect(extractProseOptions(raw)).toBeNull();
  });
});

describe("parseLoomResponse — prose salvage", () => {
  it("turns a prose list into options when the block has none", () => {
    const raw = 'The wind bites.\n\n1. Approach\n2. Wait\n\n<<<LOOM>>>\n{ "day": 3 }';
    const { prose, block } = parseLoomResponse(raw);
    expect(block?.options).toEqual(["Approach", "Wait"]);
    expect(block?.day).toBe(3);
    expect(prose).toBe("The wind bites.");
  });

  it("makes a block out of nothing when there was none at all", () => {
    const { prose, block } = parseLoomResponse("The wind bites.\n\n1. Approach\n2. Wait");
    expect(block).toEqual({ options: ["Approach", "Wait"] });
    expect(prose).toBe("The wind bites.");
  });

  it("leaves the prose alone when the block already had options", () => {
    const raw = 'Ok.\n\n1. Approach\n2. Wait\n\n<<<LOOM>>>\n{ "options": ["Run"] }';
    const { prose, block } = parseLoomResponse(raw);
    expect(block?.options).toEqual(["Run"]);
    expect(prose).toContain("1. Approach");
  });
});

describe("needsBlockRepair", () => {
  const settings = defaultSettings();

  it("fires when nothing parsed", () => {
    expect(needsBlockRepair(settings, null)).toBe(true);
  });

  it("fires when a block parsed without options", () => {
    expect(needsBlockRepair(settings, { day: 3 })).toBe(true);
    expect(needsBlockRepair(settings, { options: [] })).toBe(true);
  });

  it("does not fire once there are options — however they were salvaged", () => {
    expect(needsBlockRepair(settings, { options: ["Go north"] })).toBe(false);
  });

  it("does not fire for missing options when the player turned them off", () => {
    const off = { ...settings, features: { ...settings.features, options: false } };
    expect(needsBlockRepair(off, { day: 3 })).toBe(false);
    // A missing BLOCK still costs the turn its state changes.
    expect(needsBlockRepair(off, null)).toBe(true);
  });

  it("never fires when the player turned the repair off", () => {
    const off = { ...settings, repairBlock: false };
    expect(needsBlockRepair(off, null)).toBe(false);
  });
});

describe("mergeRepairBlock", () => {
  it("takes the whole repair when nothing parsed the first time", () => {
    const repaired = { day: 3, inventory: [{ op: "add" as const, label: "Key" }] };
    expect(mergeRepairBlock(null, repaired)).toEqual(repaired);
  });

  it("takes ONLY the options when a block already applied its ops", () => {
    const block = { day: 3, inventory: [{ op: "add" as const, label: "Key" }] };
    const merged = mergeRepairBlock(block, {
      options: ["Go north"],
      inventory: [{ op: "add" as const, label: "Key", quantity: 1 }],
      party: [{ op: "add" as const, name: "Riley" }],
    });
    expect(merged).toEqual({ ...block, options: ["Go north"] });
  });

  it("normalizes the repaired options too", () => {
    const merged = mergeRepairBlock({ day: 1 }, { options: "1. Go north" as never });
    expect(merged?.options).toEqual(["Go north"]);
  });

  it("keeps the original when the repair brought nothing", () => {
    const block = { day: 3 };
    expect(mergeRepairBlock(block, null)).toBe(block);
    expect(mergeRepairBlock(block, { options: [] })).toBe(block);
  });
});
