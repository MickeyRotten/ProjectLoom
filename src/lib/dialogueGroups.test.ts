import { describe, it, expect } from "vitest";
import { groupSegments } from "./dialogueGroups";

describe("groupSegments", () => {
  it("keeps segments from different speakers apart, in order", () => {
    const out = groupSegments([
      { speaker: null, text: "The door creaks." },
      { speaker: "Navi", text: "Careful." },
      { speaker: null, text: "She steps back." },
    ]);
    expect(out).toEqual([
      { speaker: null, texts: ["The door creaks."] },
      { speaker: "Navi", texts: ["Careful."] },
      { speaker: null, texts: ["She steps back."] },
    ]);
  });

  it("collapses consecutive lines from the same speaker into one group", () => {
    const out = groupSegments([
      { speaker: "Navi", text: "Wait." },
      { speaker: "Navi", text: "Someone's coming." },
    ]);
    expect(out).toEqual([{ speaker: "Navi", texts: ["Wait.", "Someone's coming."] }]);
  });

  it("collapses consecutive narration runs the same way as consecutive dialogue", () => {
    const out = groupSegments([
      { speaker: null, text: "First." },
      { speaker: null, text: "Second." },
    ]);
    expect(out).toEqual([{ speaker: null, texts: ["First.", "Second."] }]);
  });

  it("returns an empty array for no segments", () => {
    expect(groupSegments([])).toEqual([]);
  });
});
