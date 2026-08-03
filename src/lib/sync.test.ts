import { describe, it, expect } from "vitest";
import {
  ACTIVE_DOC,
  CHARACTERS_DOC,
  SETTINGS_DOC,
  conflictPolicy,
  conflictSlotName,
  decodeImageName,
  encodeImageName,
  isSlotDoc,
  isUntouchedGame,
  mergeSettings,
  newStamp,
  newerSide,
  planDoc,
  planImages,
  slotDoc,
  slotIdOf,
  stripLocalSettings,
  type DocStamp,
} from "./sync";
import { defaultSettings, newGame } from "./defaults";

const stamp = (patch: Partial<DocStamp> = {}): DocStamp => ({
  localAt: 0,
  syncedAt: 0,
  remoteAt: "",
  ...patch,
});

const remote = (updatedAt: string, deleted = false) => ({ updatedAt, deleted });

describe("planDoc", () => {
  it("pushes a never-synced local document the server has never seen", () => {
    expect(planDoc(undefined, true, null)).toBe("push");
  });

  it("does nothing when neither side has the document", () => {
    expect(planDoc(undefined, false, null)).toBe("none");
  });

  it("pulls a document that exists only on the server", () => {
    expect(planDoc(undefined, false, remote("2026-08-01T10:00:00Z"))).toBe("pull");
  });

  it("pushes when only this device changed", () => {
    const s = stamp({ localAt: 200, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, true, remote("2026-08-01T10:00:00Z"))).toBe("push");
  });

  it("pulls when only the server changed", () => {
    const s = stamp({ localAt: 100, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, true, remote("2026-08-01T11:00:00Z"))).toBe("pull");
  });

  it("conflicts when both sides changed since the watermark", () => {
    const s = stamp({ localAt: 200, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, true, remote("2026-08-01T11:00:00Z"))).toBe("conflict");
  });

  it("does nothing when neither moved", () => {
    const s = stamp({ localAt: 100, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, true, remote("2026-08-01T10:00:00Z"))).toBe("none");
  });

  it("applies an unseen tombstone to an unchanged local copy", () => {
    const s = stamp({ localAt: 100, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, true, remote("2026-08-01T11:00:00Z", true))).toBe("pull");
  });

  it("ignores a tombstone it has already applied", () => {
    const s = stamp({ localAt: 100, syncedAt: 100, remoteAt: "2026-08-01T11:00:00Z" });
    expect(planDoc(s, false, remote("2026-08-01T11:00:00Z", true))).toBe("none");
  });

  it("pushes a local deletion the server has not seen", () => {
    // Gone locally (hasLocal false) with a stamp that moved = a tombstone to push.
    const s = stamp({ localAt: 200, syncedAt: 100, remoteAt: "2026-08-01T10:00:00Z" });
    expect(planDoc(s, false, remote("2026-08-01T10:00:00Z"))).toBe("push");
  });
});

describe("conflictPolicy", () => {
  it("asks only for the active game", () => {
    expect(conflictPolicy(ACTIVE_DOC)).toBe("ask");
  });

  it("merges the cast, takes the newest settings, and defers on a slot", () => {
    expect(conflictPolicy(CHARACTERS_DOC)).toBe("merge");
    expect(conflictPolicy(SETTINGS_DOC)).toBe("newest");
    expect(conflictPolicy(slotDoc("abc"))).toBe("remote");
  });
});

describe("newerSide", () => {
  it("picks whichever moved last", () => {
    const t = Date.parse("2026-08-01T10:00:00Z");
    expect(newerSide(t - 1000, "2026-08-01T10:00:00Z")).toBe("remote");
    expect(newerSide(t + 1000, "2026-08-01T10:00:00Z")).toBe("local");
  });

  it("falls back to the device when the server time is unreadable", () => {
    expect(newerSide(0, "not a date")).toBe("local");
  });
});

describe("slot document keys", () => {
  it("round-trips an id", () => {
    const key = slotDoc("a-b-c");
    expect(isSlotDoc(key)).toBe(true);
    expect(slotIdOf(key)).toBe("a-b-c");
  });

  it("reports no id for a singleton key", () => {
    expect(isSlotDoc(ACTIVE_DOC)).toBe(false);
    expect(slotIdOf(ACTIVE_DOC)).toBe("");
  });
});

describe("image object names", () => {
  it("round-trips keys with colons and spaces", () => {
    for (const key of [
      "banner:Boars Head Tavern",
      "portrait:9f1c-4d2e",
      "src:portrait:9f1c-4d2e",
      "banner:Ruins of Ys — Lower Vault",
    ]) {
      expect(decodeImageName(encodeImageName(key))).toBe(key);
    }
  });

  it("produces path-safe names (no /, + or =)", () => {
    const name = encodeImageName("banner:A place with ??? and / in it");
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips non-ASCII location names", () => {
    const key = "banner:Kylän kaivo";
    expect(decodeImageName(encodeImageName(key))).toBe(key);
  });

  it("returns nothing for a name that is not one of ours", () => {
    expect(decodeImageName("!!!!not base64!!!!")).toBe("");
  });
});

describe("planImages", () => {
  it("uploads a blob the server has never seen", () => {
    expect(planImages(["portrait:a"], {}, [])).toEqual({
      upload: ["portrait:a"],
      download: [],
      remove: [],
    });
  });

  it("downloads a blob this device has never had", () => {
    const plan = planImages([], {}, [{ key: "portrait:b", updatedAt: "2026-08-01T10:00:00Z" }]);
    expect(plan.download).toEqual(["portrait:b"]);
    expect(plan.remove).toEqual([]);
  });

  it("leaves a blob both sides already agree on alone", () => {
    const stamps = {
      "portrait:a": stamp({ localAt: 5, syncedAt: 5, remoteAt: "2026-08-01T10:00:00Z" }),
    };
    const plan = planImages(["portrait:a"], stamps, [
      { key: "portrait:a", updatedAt: "2026-08-01T10:00:00Z" },
    ]);
    expect(plan).toEqual({ upload: [], download: [], remove: [] });
  });

  it("propagates a local deletion to the server", () => {
    const stamps = {
      "portrait:a": stamp({ localAt: 20, syncedAt: 5, remoteAt: "2026-08-01T10:00:00Z" }),
    };
    const plan = planImages([], stamps, [{ key: "portrait:a", updatedAt: "2026-08-01T10:00:00Z" }]);
    expect(plan.remove).toEqual(["portrait:a"]);
  });

  it("re-downloads a blob the player never deleted here", () => {
    // Stamp says synced, blob is missing (cache evicted, fresh install) — the
    // server's copy comes back rather than being deleted from under the player.
    const stamps = {
      "portrait:a": stamp({ localAt: 5, syncedAt: 5, remoteAt: "2026-08-01T10:00:00Z" }),
    };
    const plan = planImages([], stamps, [{ key: "portrait:a", updatedAt: "2026-08-01T10:00:00Z" }]);
    expect(plan).toEqual({ upload: [], download: ["portrait:a"], remove: [] });
  });

  it("settles a two-sided image change on the newer one, silently", () => {
    const stamps = {
      "portrait:a": stamp({
        localAt: Date.parse("2026-08-01T12:00:00Z"),
        syncedAt: 1,
        remoteAt: "2026-08-01T10:00:00Z",
      }),
      "portrait:b": stamp({
        localAt: Date.parse("2026-08-01T09:00:00Z"),
        syncedAt: 1,
        remoteAt: "2026-08-01T10:00:00Z",
      }),
    };
    const plan = planImages(["portrait:a", "portrait:b"], stamps, [
      { key: "portrait:a", updatedAt: "2026-08-01T11:00:00Z" },
      { key: "portrait:b", updatedAt: "2026-08-01T11:00:00Z" },
    ]);
    expect(plan.upload).toEqual(["portrait:a"]);
    expect(plan.download).toEqual(["portrait:b"]);
  });
});

describe("settings", () => {
  it("keeps the per-device fields out of what is pushed", () => {
    const s = {
      ...defaultSettings(),
      openRouterKey: "sk-or-real",
      supabaseUrl: "https://ref.supabase.co",
      supabaseAnonKey: "anon-key",
      comfyUrl: "http://192.168.1.9:8188",
    };
    const pushed = stripLocalSettings(s) as Partial<typeof s>;
    expect(pushed.supabaseUrl).toBeUndefined();
    expect(pushed.supabaseAnonKey).toBeUndefined();
    expect(pushed.comfyUrl).toBeUndefined();
    expect(pushed.syncEnabled).toBeUndefined();
    // The API key rides along on purpose — a new device is playable at once.
    expect(pushed.openRouterKey).toBe("sk-or-real");
  });

  it("never lets a pulled blob overwrite this device's own cloud config", () => {
    const local = {
      ...defaultSettings(),
      supabaseUrl: "https://mine.supabase.co",
      supabaseAnonKey: "mine",
      comfyUrl: "http://192.168.1.9:8188",
    };
    // A doc written by an older build still carrying the fields.
    const incoming = {
      temperature: 0.9,
      supabaseUrl: "https://theirs.supabase.co",
      supabaseAnonKey: "theirs",
      comfyUrl: "http://10.0.0.5:8188",
    };
    const merged = mergeSettings(local, incoming);
    expect(merged.temperature).toBe(0.9);
    expect(merged.supabaseUrl).toBe("https://mine.supabase.co");
    expect(merged.supabaseAnonKey).toBe("mine");
    expect(merged.comfyUrl).toBe("http://192.168.1.9:8188");
  });
});

describe("isUntouchedGame", () => {
  it("counts a fresh game as no game at all", () => {
    expect(isUntouchedGame(newGame())).toBe(true);
  });

  it("counts one taken turn as a game worth defending", () => {
    const played = {
      ...newGame(),
      turnNumber: 1,
      messages: [{ id: "m1", role: "player" as const, content: "look", turn: 1 }],
    };
    expect(isUntouchedGame(played)).toBe(false);
  });

  it("does not care that the scenario was edited before play started", () => {
    const authored = { ...newGame(), scenario: { ...newGame().scenario, title: "My World" } };
    expect(isUntouchedGame(authored)).toBe(true);
  });
});

describe("conflictSlotName", () => {
  it("names each side so the loser is findable in Saves", () => {
    const when = Date.parse("2026-08-01T10:00:00Z");
    expect(conflictSlotName("local", when)).toContain("local");
    expect(conflictSlotName("cloud", when)).toContain("cloud");
  });
});

describe("newStamp", () => {
  it("starts unsynced, so a first pass pushes what is already here", () => {
    const s = newStamp(42);
    expect(s).toEqual({ localAt: 42, syncedAt: 0, remoteAt: "" });
    expect(planDoc(s, true, null)).toBe("push");
  });
});
