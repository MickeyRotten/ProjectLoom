import { describe, it, expect } from "vitest";
import { deriveToasts } from "./toasts";
import type { LoomBlock, Message, Reversal } from "../types";

function narr(block?: LoomBlock, reversal?: Reversal): Message {
  return {
    id: "n1",
    role: "narrator",
    content: "…",
    turn: 1,
    appliedDeltas: block,
    reversal,
  };
}

const rev = (location: string): Reversal => ({ day: 1, location, weather: "clear" });

describe("deriveToasts — party standings", () => {
  it("reports a plain add as joining the party", () => {
    expect(deriveToasts(narr({ party: [{ op: "add", name: "Navi" }] }))).toEqual([
      "Navi joined the party",
    ]);
  });

  it("never calls an NPC or a benched arrival a party join", () => {
    expect(deriveToasts(narr({ party: [{ op: "add", name: "Mira", standing: "npc" }] }))).toEqual([
      "Mira is known here",
    ]);
    expect(
      deriveToasts(narr({ party: [{ op: "add", name: "Bram", standing: "benched" }] })),
    ).toEqual(["Bram stayed behind"]);
  });

  it("reports a standing move made by an update", () => {
    expect(
      deriveToasts(narr({ party: [{ op: "update", name: "Navi", standing: "benched" }] })),
    ).toEqual(["Navi stayed behind"]);
  });

  it("stays silent for an update that only rewrote a sheet", () => {
    expect(deriveToasts(narr({ party: [{ op: "update", name: "Navi", drive: "revenge" }] }))).toEqual(
      [],
    );
  });
});

describe("deriveToasts", () => {
  it("returns nothing without an applied block", () => {
    expect(deriveToasts(narr())).toEqual([]);
    expect(deriveToasts(narr({}))).toEqual([]);
  });

  it("announces a location change against the pre-turn reversal", () => {
    const m = narr({ location: "Rodstroke" }, rev("Murkwood Entrance"));
    expect(deriveToasts(m)).toEqual(["Entered location: Rodstroke"]);
  });

  it("stays quiet when the model restates the same location", () => {
    const m = narr({ location: "Rodstroke" }, rev("Rodstroke"));
    expect(deriveToasts(m)).toEqual([]);
  });

  it("stays quiet on location without a reversal snapshot (old saves)", () => {
    const m = narr({ location: "Rodstroke" });
    expect(deriveToasts(m)).toEqual([]);
  });

  it("announces party joins and departures", () => {
    const m = narr({
      party: [
        { op: "add", name: "Navi" },
        { op: "remove", name: "Riley" },
      ],
    });
    expect(deriveToasts(m)).toEqual(["Navi joined the party", "Riley left the party"]);
  });

  it("announces inventory adds with quantity, removes, and quantity updates", () => {
    const m = narr({
      inventory: [
        { op: "add", label: "Cracked Compass" },
        { op: "add", label: "Ration", quantity: 3 },
        { op: "remove", label: "Torch" },
        { op: "update", label: "Rope", quantity: 2 },
        { op: "update", label: "Knife", description: "sharp" },
      ],
    });
    expect(deriveToasts(m)).toEqual([
      "Cracked Compass added to inventory",
      "Ration added to inventory ×3",
      "Torch removed from inventory",
      "Rope ×2",
    ]);
  });

  it("treats Gold as the purse — gains, new totals, and emptying", () => {
    const gained = narr({ inventory: [{ op: "add", label: "Gold", quantity: 25 }] });
    expect(deriveToasts(gained)).toEqual(["+25 Gold"]);

    const total = narr({ inventory: [{ op: "update", label: "gold", quantity: 120 }] });
    expect(deriveToasts(total)).toEqual(["Gold: 120"]);

    const emptied = narr({ inventory: [{ op: "remove", label: "Gold" }] });
    expect(deriveToasts(emptied)).toEqual(["Gold: 0"]);
  });

  it("announces quest starts, completions, and removals", () => {
    const m = narr({
      quests: [
        { op: "add", label: "Reach the Old Settlement" },
        { op: "update", label: "Find Water", status: "done" },
        { op: "update", label: "Find Shelter", description: "tweaked" },
        { op: "remove", label: "Lost Cause" },
      ],
    });
    expect(deriveToasts(m)).toEqual([
      "Quest started: Reach the Old Settlement",
      "Quest completed: Find Water",
      "Quest removed: Lost Cause",
    ]);
  });

  it("orders mixed toasts location → party → inventory → quests", () => {
    const m = narr(
      {
        location: "The Ruins",
        party: [{ op: "add", name: "Navi" }],
        inventory: [{ op: "add", label: "Key" }],
        quests: [{ op: "add", label: "Open the Vault" }],
      },
      rev("Murkwood Entrance"),
    );
    expect(deriveToasts(m)).toEqual([
      "Entered location: The Ruins",
      "Navi joined the party",
      "Key added to inventory",
      "Quest started: Open the Vault",
    ]);
  });
});

describe("deriveToasts — conditions", () => {
  it("reports a new mark", () => {
    expect(
      deriveToasts(narr({ conditions: [{ name: "Navi", condition: "Winded" }] })),
    ).toEqual(["Navi: Winded"]);
  });

  it("reports a cleared mark as recovery, not as a blank chip", () => {
    expect(
      deriveToasts(narr({ conditions: [{ name: "Navi", condition: "  " }] })),
    ).toEqual(["Navi recovered"]);
  });

  it("skips malformed rows", () => {
    expect(
      deriveToasts(
        narr({
          conditions: [
            { name: "", condition: "x" },
            { name: "Navi" } as never,
          ],
        }),
      ),
    ).toEqual([]);
  });
});
