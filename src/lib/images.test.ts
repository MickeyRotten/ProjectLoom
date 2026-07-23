import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bannerKey,
  blobToDataUrl,
  buildBannerPrompt,
  buildEditPrompt,
  buildPortraitPrompt,
  dataUrlToBlob,
  extractImageDataUrl,
  generateImage,
  portraitKey,
} from "./images";
import type { Settings } from "../types";

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

  it("custom portrait prompt replaces the auto identity/appearance lines", () => {
    const p = buildPortraitPrompt(
      {
        name: "Navi",
        species: "sprite",
        description: "A flickering mote.",
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "A neon fox in a trench coat.",
      },
      "1-bit portrait.",
    );
    expect(p).toBe("1-bit portrait.\n\nA neon fox in a trench coat.");
    expect(p).not.toContain("Name: Navi.");
    expect(p).not.toContain("Appearance:");
  });

  it("falls back to auto lines when the custom flag is on but the prompt is blank", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A mote.", useCustomPortraitPrompt: true, customPortraitPrompt: "  " },
      "style",
    );
    expect(p).toContain("Name: Navi.");
  });

  it("edit prompt folds in the instruction and a style-preservation line", () => {
    const p = buildEditPrompt("  add a full moon  ");
    expect(p).toContain("Edit the attached image: add a full moon");
    expect(p).toContain("Preserve the existing style");
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

describe("blobToDataUrl", () => {
  it("round-trips a blob through a base64 data URL", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const url = await blobToDataUrl(blob);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrlToBlob(url).size).toBe(blob.size);
  });
});

describe("generateImage request shapes", () => {
  const settings = {
    openRouterKey: "sk-test",
    imageModelId: "google/gemini-2.5-flash-image",
  } as Settings;
  const reply = {
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] } }],
      }),
  };

  afterEach(() => vi.unstubAllGlobals());

  it("text-only generation sends a plain string content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "a tower" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toBe("a tower");
  });

  it("edit sends text + image_url parts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "add a moon", image: "data:image/png;base64,BBBB" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "add a moon" },
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    ]);
  });
});
