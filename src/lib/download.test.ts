import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFileName, saveBlobAsFile } from "./download";

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
    expect(imageFileName("Old Mill", "banner", "jpg")).toBe("loom-old-mill-banner.jpg");
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

  it("throws when neither path exists", async () => {
    stubShare({});
    vi.stubGlobal("URL", {});
    await expect(saveBlobAsFile(blob, "x.png")).rejects.toThrow();
  });
});
