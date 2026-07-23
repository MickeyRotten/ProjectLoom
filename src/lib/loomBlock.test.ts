import { describe, it, expect } from "vitest";
import { parseLoomResponse, truncateForDisplay } from "./loomBlock";

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
