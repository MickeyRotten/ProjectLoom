import { describe, expect, it } from "vitest";
import type { Character, LoomBlock } from "../types";
import {
  applyVerification,
  buildVerifyMessages,
  parseVerifyResult,
  pendingVerification,
  type VerifyCandidate,
} from "./verifyOps";

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

describe("pendingVerification", () => {
  const cast = [member("pc", "Hiro", { role: "pc" }), member("m-1", "Vex")];

  it("is empty for a block with no adds", () => {
    expect(pendingVerification({}, cast)).toEqual([]);
    expect(pendingVerification({ party: [{ op: "update", name: "Vex", standing: "benched" }] }, cast)).toEqual(
      [],
    );
  });

  it("flags a party add naming nobody in the cast", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Riley", description: "a scout" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", index: 0, label: "Riley", description: "a scout" },
    ]);
  });

  it("skips a party add naming someone who already exists", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Vex" }] };
    expect(pendingVerification(block, cast)).toEqual([]);
  });

  it("flags a party add naming the PC — party ops never resolve to the PC, so it reads as a new creation, same as `applyParty`", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Hiro" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", index: 0, label: "Hiro", description: undefined },
    ]);
  });

  it("flags every inventory add, regardless of the cast", () => {
    const block: LoomBlock = {
      inventory: [
        { op: "add", label: "Rusty Key", description: "an old key", quantity: 1 },
        { op: "update", label: "Rusty Key" },
        { op: "add", label: "Torch" },
      ],
    };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "inventory", index: 0, label: "Rusty Key", description: "an old key" },
      { kind: "inventory", index: 2, label: "Torch", description: undefined },
    ]);
  });
});

describe("buildVerifyMessages", () => {
  it("numbers the claims and carries the prose", () => {
    const candidates: VerifyCandidate[] = [
      { kind: "party", index: 0, label: "Riley", description: "a scout" },
      { kind: "inventory", index: 1, label: "Torch" },
    ];
    const joined = buildVerifyMessages("You light the torch and Riley waves.", candidates)
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("1. [a NEW character introduced] Riley — a scout");
    expect(joined).toContain("2. [an item TAKEN] Torch");
    expect(joined).toContain("You light the torch and Riley waves.");
  });
});

describe("parseVerifyResult", () => {
  it("reads a well-formed reply", () => {
    const raw = '{"results":[{"index":1,"supported":true},{"index":2,"supported":false}]}';
    expect(parseVerifyResult(raw, 2)).toEqual([true, false]);
  });

  it("defaults every entry to supported when the reply is unparseable", () => {
    expect(parseVerifyResult("not json at all", 2)).toEqual([true, true]);
    expect(parseVerifyResult("", 2)).toEqual([true, true]);
  });

  it("defaults an entry the reply never mentions, or mentions with a bad shape", () => {
    const raw = '{"results":[{"index":2,"supported":false},{"index":9,"supported":false}]}';
    expect(parseVerifyResult(raw, 2)).toEqual([true, false]);
  });

  it("tolerates fences and preamble", () => {
    const raw = 'Sure, here you go:\n```json\n{"results":[{"index":1,"supported":false}]}\n```';
    expect(parseVerifyResult(raw, 1)).toEqual([false]);
  });
});

describe("applyVerification", () => {
  it("returns the same block reference when nothing is vetoed", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Riley" }] };
    const candidates: VerifyCandidate[] = [{ kind: "party", index: 0, label: "Riley" }];
    expect(applyVerification(block, candidates, [true])).toBe(block);
  });

  it("drops a vetoed party add and leaves the rest untouched", () => {
    const block: LoomBlock = {
      party: [
        { op: "add", name: "Riley" },
        { op: "update", name: "Vex", standing: "benched" },
      ],
    };
    const candidates: VerifyCandidate[] = [{ kind: "party", index: 0, label: "Riley" }];
    const next = applyVerification(block, candidates, [false]);
    expect(next.party).toEqual([{ op: "update", name: "Vex", standing: "benched" }]);
  });

  it("drops a vetoed inventory add by index, independent of party", () => {
    const block: LoomBlock = {
      inventory: [
        { op: "add", label: "Rusty Key" },
        { op: "add", label: "Torch" },
      ],
    };
    const candidates: VerifyCandidate[] = [
      { kind: "inventory", index: 0, label: "Rusty Key" },
      { kind: "inventory", index: 1, label: "Torch" },
    ];
    const next = applyVerification(block, candidates, [true, false]);
    expect(next.inventory).toEqual([{ op: "add", label: "Rusty Key" }]);
  });
});
