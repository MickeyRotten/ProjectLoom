import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobToBase64, imageFileName, saveBlobAsFile } from "./download";

// The APK's three moving parts. `native` flips the platform check per test;
// the plugins themselves are never real here (they'd need a device).
const cap = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn<
    (opts: { path: string; data: string; directory: string }) => Promise<{ uri: string }>
  >(async () => ({ uri: "file:///cache/loom-a-portrait.png" })),
  share: vi.fn<(opts: { files?: string[]; title?: string }) => Promise<unknown>>(
    async () => ({}),
  ),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => cap.native },
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: cap.writeFile },
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: cap.share } }));

beforeEach(() => {
  cap.native = false;
  cap.writeFile.mockClear();
  cap.share.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("imageFileName", () => {
  it("slugifies a character name", () => {
    expect(imageFileName("Ilse the Grey")).toBe("loom-ilse-the-grey-portrait.png");
  });

  it("collapses punctuation and trims edge dashes", () => {
    expect(imageFileName("  ¡Vex!! — Ironhand  ")).toBe("loom-vex-ironhand-portrait.png");
  });

  it("falls back when nothing usable survives", () => {
    expect(imageFileName("???")).toBe("loom-character-portrait.png");
    expect(imageFileName("")).toBe("loom-character-portrait.png");
  });

  it("truncates without leaving a trailing dash", () => {
    const name = `${"a".repeat(48)} b`;
    expect(imageFileName(name)).toBe(`loom-${"a".repeat(48)}-portrait.png`);
  });

  it("takes a custom suffix and extension", () => {
    expect(imageFileName("Old Mill", "master", "jpg")).toBe("loom-old-mill-master.jpg");
  });
});

/** Stub the share half of navigator; `undefined` canShare = no file support. */
function stubShare(opts: {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}) {
  vi.stubGlobal("navigator", { ...opts } as Navigator);
}

function stubObjectUrl() {
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: revoke,
  });
  return revoke;
}

describe("saveBlobAsFile", () => {
  const blob = new Blob(["x"], { type: "image/png" });

  it("shares the file when the platform can", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare({ canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.files?.[0].name).toBe("loom-a-portrait.png");
    expect(click).not.toHaveBeenCalled();
  });

  it("treats a dismissed share sheet as done — no download fallback", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    stubShare({ canShare: () => true, share: vi.fn().mockRejectedValue(abort) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(click).not.toHaveBeenCalled();
  });

  it("falls back to a download when share fails for real", async () => {
    stubShare({ canShare: () => true, share: vi.fn().mockRejectedValue(new Error("nope")) });
    stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("downloads when the platform can't share files", async () => {
    stubShare({});
    stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull(); // the anchor is removed again
  });

  it("attempts a share the platform won't vouch for, and still falls back", async () => {
    // An engine with `share` but no `canShare` used to skip sharing entirely.
    stubShare({ share: vi.fn().mockRejectedValue(new Error("nope")) });
    stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("throws when neither path exists", async () => {
    stubShare({});
    vi.stubGlobal("URL", {});
    await expect(saveBlobAsFile(blob, "x.png")).rejects.toThrow();
  });
});

describe("saveBlobAsFile on the APK", () => {
  const blob = new Blob(["x"], { type: "image/png" });

  it("writes to the cache dir and opens the native share sheet", async () => {
    cap.native = true;
    // The WebView offers neither web path — this is the real device shape.
    stubShare({});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(cap.writeFile).toHaveBeenCalledWith({
      path: "loom-a-portrait.png",
      data: await blobToBase64(blob),
      directory: "CACHE",
    });
    expect(cap.share.mock.calls[0][0]).toMatchObject({
      files: ["file:///cache/loom-a-portrait.png"],
    });
    expect(click).not.toHaveBeenCalled(); // never the dead WebView fallback
  });

  it("treats a dismissed native sheet as done", async () => {
    cap.native = true;
    cap.share.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(saveBlobAsFile(blob, "loom-a-portrait.png")).resolves.toBeUndefined();
  });

  it("reports a real native failure instead of falling through", async () => {
    cap.native = true;
    cap.share.mockRejectedValueOnce(new Error("no activity found"));
    stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(saveBlobAsFile(blob, "loom-a-portrait.png")).rejects.toThrow(
      "no activity found",
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("stays off the plugins on the web build", async () => {
    stubShare({});
    stubObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await saveBlobAsFile(blob, "loom-a-portrait.png");

    expect(cap.writeFile).not.toHaveBeenCalled();
    expect(cap.share).not.toHaveBeenCalled();
  });
});

describe("blobToBase64", () => {
  it("strips the data-URL prefix", async () => {
    expect(await blobToBase64(new Blob(["hi"], { type: "image/png" }))).toBe("aGk=");
  });
});
