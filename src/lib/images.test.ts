import { describe, expect, it } from "vitest";
import {
  bannerKey,
  buildBannerPrompt,
  buildPortraitPrompt,
  dataUrlToBlob,
  extractImageDataUrl,
  portraitKey,
} from "./images";

describe("cache keys", () => {
  it("banner key is case/whitespace-insensitive", () => {
    expect(bannerKey("The Dusty Path")).toBe("banner:the dusty path");
    expect(bannerKey("  THE DUSTY PATH  ")).toBe(bannerKey("the dusty path"));
  });

  it("portrait key is the raw member id", () => {
    expect(portraitKey("m-navi")).toBe("portrait:m-navi");
  });
});

describe("prompt builders", () => {
  it("banner prompt folds in style, location, and excerpt", () => {
    const p = buildBannerPrompt("The Dusty Path", "Grit stings your eyes.", "1-bit line art.");
    expect(p).toContain("1-bit line art.");
    expect(p).toContain("Location: The Dusty Path.");
    expect(p).toContain("Scene: Grit stings your eyes.");
  });

  it("banner prompt omits an empty excerpt", () => {
    const p = buildBannerPrompt("Ruins", "   ", "style");
    expect(p).not.toContain("Scene:");
  });

  it("portrait prompt folds in style, identity, and appearance", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A flickering mote of light." },
      "1-bit portrait.",
    );
    expect(p).toContain("1-bit portrait.");
    expect(p).toContain("Name: Navi.");
    expect(p).toContain("Species: sprite.");
    expect(p).toContain("Appearance: A flickering mote of light.");
  });

  it("portrait prompt tolerates blank identity fields", () => {
    const p = buildPortraitPrompt({ name: "", species: "", description: "" }, "style");
    expect(p).toBe("style");
  });
});

describe("extractImageDataUrl", () => {
  const dataUrl = "data:image/png;base64,AAAA";

  it("reads images[].image_url.url", () => {
    const json = { choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }] };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("reads a bare images[].url", () => {
    const json = { choices: [{ message: { images: [{ url: dataUrl }] } }] };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("falls back to a data URL in message.content", () => {
    const json = { choices: [{ message: { content: dataUrl } }] };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("skips non-image entries and returns the first data URL", () => {
    const json = {
      choices: [{ message: { images: [{ image_url: { url: "https://x/y.png" } }, { image_url: { url: dataUrl } }] } }],
    };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("returns null when there is no image", () => {
    expect(extractImageDataUrl({ choices: [{ message: { content: "just text" } }] })).toBeNull();
    expect(extractImageDataUrl({})).toBeNull();
    expect(extractImageDataUrl(null)).toBeNull();
  });
});

describe("dataUrlToBlob", () => {
  it("decodes a base64 data URL to a typed Blob", () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3); // "AAAA" base64 → 3 bytes
  });

  it("throws on a malformed data URL", () => {
    expect(() => dataUrlToBlob("not-a-data-url")).toThrow();
  });
});
