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
  const cast = [member("pc", "Hiro", { role: "pc" }), member("m-1", "Vex"), member("m-2", "Bram")];

  it("is empty for a block with no claims worth asking about", () => {
    expect(pendingVerification({}, cast)).toEqual([]);
    expect(pendingVerification({ party: [{ op: "update", name: "Vex", standing: "benched" }] }, cast)).toEqual(
      [],
    );
  });

  it("flags a party add naming nobody in the cast as a create", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Riley", description: "a scout" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", claim: "create", index: 0, label: "Riley", description: "a scout" },
    ]);
  });

  it("skips a party add naming someone who already exists", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Vex" }] };
    expect(pendingVerification(block, cast)).toEqual([]);
  });

  it("flags a party add naming the PC — party ops never resolve to the PC, so it reads as a new creation, same as `applyParty`", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Hiro" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", claim: "create", index: 0, label: "Hiro", description: undefined },
    ]);
  });

  it("flags a newName landing on somebody found as a rename", () => {
    const block: LoomBlock = { party: [{ op: "update", name: "Vex", newName: "Vexia" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", claim: "rename", index: 0, label: "Vexia" },
    ]);
  });

  it("skips a newName that resolves to the same person's current name", () => {
    const block: LoomBlock = { party: [{ op: "update", name: "Vex", newName: "vex" }] };
    expect(pendingVerification(block, cast)).toEqual([]);
  });

  it("skips a newName naming somebody not found — nothing to rename", () => {
    const block: LoomBlock = { party: [{ op: "add", name: "Riley", newName: "Ry" }] };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", claim: "create", index: 0, label: "Riley", description: undefined },
    ]);
  });

  it("flags a remove resolving to fallen or departed for somebody found", () => {
    const block: LoomBlock = {
      party: [
        { op: "remove", name: "Vex", standing: "fallen" },
        { op: "remove", name: "Bram" },
      ],
    };
    expect(pendingVerification(block, cast)).toEqual([
      { kind: "party", claim: "exit", index: 0, label: "Vex", description: "fallen" },
      { kind: "party", claim: "exit", index: 1, label: "Bram", description: "departed" },
    ]);
  });

  it("skips a remove naming the PC — party ops never resolve to the PC, so there is nobody found to check", () => {
    const block: LoomBlock = { party: [{ op: "remove", name: "Hiro", standing: "fallen" }] };
    expect(pendingVerification(block, cast)).toEqual([]);
  });

  it("skips a remove that steps back to npc or none — a standing change, not an irreversible beat", () => {
    const block: LoomBlock = {
      party: [
        { op: "remove", name: "Vex", standing: "npc" },
        { op: "remove", name: "Bram", standing: "none" },
      ],
    };
    expect(pendingVerification(block, cast)).toEqual([]);
  });

  it("skips a remove naming nobody found — nothing to check", () => {
    const block: LoomBlock = { party: [{ op: "remove", name: "Nobody", standing: "fallen" }] };
    expect(pendingVerification(block, cast)).toEqual([]);
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
      { kind: "inventory", claim: "taken", index: 0, label: "Rusty Key", description: "an old key" },
      { kind: "inventory", claim: "taken", index: 2, label: "Torch", description: undefined },
    ]);
  });
});

describe("buildVerifyMessages", () => {
  it("numbers the claims and carries the prose", () => {
    const candidates: VerifyCandidate[] = [
      { kind: "party", claim: "create", index: 0, label: "Riley", description: "a scout" },
      { kind: "inventory", claim: "taken", index: 1, label: "Torch" },
    ];
    const joined = buildVerifyMessages("You light the torch and Riley waves.", candidates)
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("1. [a NEW character introduced] Riley — a scout");
    expect(joined).toContain("2. [an item TAKEN] Torch");
    expect(joined).toContain("You light the torch and Riley waves.");
  });

  it("only states the rule for claim kinds actually being asked about", () => {
    const candidates: VerifyCandidate[] = [
      { kind: "party", claim: "rename", index: 0, label: "Vexia" },
    ];
    const joined = buildVerifyMessages("prose", candidates)
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("[a character renamed]");
    expect(joined).not.toContain("[a NEW character introduced]");
    expect(joined).not.toContain("[an item TAKEN]");
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
    const candidates: VerifyCandidate[] = [{ kind: "party", claim: "create", index: 0, label: "Riley" }];
    expect(applyVerification(block, candidates, [true])).toBe(block);
  });

  it("drops a vetoed party create and leaves the rest untouched", () => {
    const block: LoomBlock = {
      party: [
        { op: "add", name: "Riley" },
        { op: "update", name: "Vex", standing: "benched" },
      ],
    };
    const candidates: VerifyCandidate[] = [{ kind: "party", claim: "create", index: 0, label: "Riley" }];
    const next = applyVerification(block, candidates, [false]);
    expect(next.party).toEqual([{ op: "update", name: "Vex", standing: "benched" }]);
  });

  it("drops a vetoed party exit entirely — the character stays where they stood", () => {
    const block: LoomBlock = { party: [{ op: "remove", name: "Vex", standing: "fallen" }] };
    const candidates: VerifyCandidate[] = [
      { kind: "party", claim: "exit", index: 0, label: "Vex", description: "fallen" },
    ];
    const next = applyVerification(block, candidates, [false]);
    expect(next.party).toEqual([]);
  });

  it("strips only newName on a vetoed rename, keeping the rest of that op", () => {
    const block: LoomBlock = {
      party: [{ op: "update", name: "Vex", newName: "Vexia", standing: "active" }],
    };
    const candidates: VerifyCandidate[] = [{ kind: "party", claim: "rename", index: 0, label: "Vexia" }];
    const next = applyVerification(block, candidates, [false]);
    expect(next.party).toEqual([{ op: "update", name: "Vex", standing: "active" }]);
  });

  it("drops a vetoed inventory taken by index, independent of party", () => {
    const block: LoomBlock = {
      inventory: [
        { op: "add", label: "Rusty Key" },
        { op: "add", label: "Torch" },
      ],
    };
    const candidates: VerifyCandidate[] = [
      { kind: "inventory", claim: "taken", index: 0, label: "Rusty Key" },
      { kind: "inventory", claim: "taken", index: 1, label: "Torch" },
    ];
    const next = applyVerification(block, candidates, [true, false]);
    expect(next.inventory).toEqual([{ op: "add", label: "Rusty Key" }]);
  });
});
