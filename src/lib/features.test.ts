import { describe, it, expect } from "vitest";
import {
  allFeatures,
  defaultFeatures,
  FEATURE_KEYS,
  filterBlock,
  normalizeFeatures,
  writesBlock,
} from "./features";
import { defaultSettings } from "./defaults";
import type { LoomBlock } from "../types";

describe("defaultFeatures", () => {
  it("ships everything on", () => {
    const f = defaultFeatures();
    for (const key of FEATURE_KEYS) expect(f[key]).toBe(true);
  });

  it("is what a fresh Settings carries", () => {
    expect(defaultSettings().features).toEqual(defaultFeatures());
  });
});

describe("allFeatures", () => {
  it("sets every flag the same way", () => {
    expect(allFeatures(false)).toEqual(
      Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])),
    );
    expect(allFeatures(true)).toEqual(defaultFeatures());
  });
});

describe("normalizeFeatures", () => {
  it("reads a missing blob as everything on", () => {
    expect(normalizeFeatures(undefined)).toEqual(defaultFeatures());
    expect(normalizeFeatures(null)).toEqual(defaultFeatures());
    expect(normalizeFeatures("quests")).toEqual(defaultFeatures());
  });

  it("keeps the flags a stored blob sets", () => {
    const f = normalizeFeatures({ quests: false, inventory: false });
    expect(f.quests).toBe(false);
    expect(f.inventory).toBe(false);
    // A flag the stored blob never heard of — every one added after it was
    // written — reads as ON, so a new feature is a non-event for old settings.
    expect(f.places).toBe(true);
  });

  it("only a literal false switches anything off", () => {
    const f = normalizeFeatures({ quests: 0, inventory: "no", notes: null });
    expect(f.quests).toBe(true);
    expect(f.inventory).toBe(true);
    expect(f.notes).toBe(true);
  });

  it("folds the three retired flat keys", () => {
    const f = normalizeFeatures(undefined, {
      showActionOptions: false,
      journalEnabled: false,
      stakesEnabled: false,
    });
    expect(f.options).toBe(false);
    expect(f.journal).toBe(false);
    expect(f.stakes).toBe(false);
    expect(f.quests).toBe(true);
  });

  it("prefers the stored flag over the retired key", () => {
    const f = normalizeFeatures({ journal: true }, { journalEnabled: false });
    expect(f.journal).toBe(true);
  });
});

describe("filterBlock", () => {
  const full: LoomBlock = {
    location: "Damp Cellar",
    area: "Boars Head Tavern",
    weather: "close and still",
    duration: "scene",
    options: ["Look around"],
    party: [{ op: "add", name: "Grik" }],
    conditions: [{ name: "Hiro", condition: "winded" }],
    inventory: [{ op: "add", label: "Rusty Key" }],
    quests: [{ op: "add", label: "Find the cellar door" }],
    notes: [{ op: "add", title: "The Cellar" }],
    spoke: ["Grik"],
  };

  it("returns the block untouched when everything is on", () => {
    expect(filterBlock(full, defaultFeatures())).toBe(full);
  });

  it("returns the block untouched when a disabled channel is absent", () => {
    const quiet: LoomBlock = { duration: "moment" };
    const off = { ...defaultFeatures(), quests: false };
    expect(filterBlock(quiet, off)).toBe(quiet);
  });

  it("strips only the channels that are off", () => {
    const off = { ...defaultFeatures(), quests: false, inventory: false };
    const out = filterBlock(full, off);
    expect(out.quests).toBeUndefined();
    expect(out.inventory).toBeUndefined();
    expect(out.party).toEqual(full.party);
    expect(out.notes).toEqual(full.notes);
  });

  it("never mutates the block it was given", () => {
    filterBlock(full, allFeatures(false));
    expect(full.quests).toBeDefined();
    expect(full.party).toBeDefined();
  });

  it("maps each channel to the feature that owns it", () => {
    const off = (key: keyof ReturnType<typeof defaultFeatures>) =>
      filterBlock(full, { ...defaultFeatures(), [key]: false });

    expect(off("options").options).toBeUndefined();
    expect(off("characters").party).toBeUndefined();
    expect(off("spotlight").spoke).toBeUndefined();
    expect(off("conditions").conditions).toBeUndefined();
    expect(off("inventory").inventory).toBeUndefined();
    expect(off("quests").quests).toBeUndefined();
    expect(off("notes").notes).toBeUndefined();
    expect(off("places").area).toBeUndefined();
    expect(off("location").location).toBeUndefined();
    expect(off("weather").weather).toBeUndefined();
    expect(off("clock").duration).toBeUndefined();
  });

  it("strips the retired day field with the clock", () => {
    const out = filterBlock({ ...full, day: 9 }, { ...defaultFeatures(), clock: false });
    expect(out.day).toBeUndefined();
    expect(out.duration).toBeUndefined();
  });

  it("leaves nothing but prose behind with every feature off", () => {
    expect(filterBlock(full, allFeatures(false))).toEqual({});
  });
});

describe("writesBlock", () => {
  it("is true while any channel is on", () => {
    expect(writesBlock(defaultFeatures())).toBe(true);
    expect(writesBlock({ ...allFeatures(false), quests: true })).toBe(true);
  });

  it("is false when every channel is off", () => {
    expect(writesBlock(allFeatures(false))).toBe(false);
  });

  it("ignores the features that own no channel", () => {
    // The journal is written by the client, the gear block is read-only
    // context, and the stakes roll happens before the model is called. None of
    // them is a reason to spend a repair request on an empty block.
    const off = allFeatures(false);
    expect(writesBlock({ ...off, journal: true, gear: true, stakes: true })).toBe(false);
  });
});
