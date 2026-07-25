import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bannerKey,
  blobToDataUrl,
  buildBannerPrompt,
  buildEditPrompt,
  buildPortraitPrompt,
  dataUrlToBlob,
  EXPORT_MIN_WIDTH,
  exportScale,
  extractImageDataUrl,
  extractMessageText,
  generateImage,
  ImageError,
  imageRequestKey,
  isModelSafeImage,
  PORTRAIT_PIXEL_WIDTH,
  portraitKey,
  prepareUploadedImage,
  sourceKey,
  toExportBlob,
  toOneBitBlob,
  toSourceBlob,
  UPLOAD_PLAIN_WIDTH,
  uploadStoredWidth,
} from "./images";
import type { Settings } from "../types";
import type { PortraitInstructions } from "./images";

function instr(overrides: Partial<PortraitInstructions> = {}): PortraitInstructions {
  return { action: "", context: "", composition: "", style: "", ...overrides };
}

// Several suites stub globals (fetch, createImageBitmap) — never leak one.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cache keys", () => {
  it("banner key is case/whitespace-insensitive", () => {
    expect(bannerKey("The Dusty Path")).toBe("banner:the dusty path");
    expect(bannerKey("  THE DUSTY PATH  ")).toBe(bannerKey("the dusty path"));
  });

  it("portrait key is the raw member id", () => {
    expect(portraitKey("m-navi")).toBe("portrait:m-navi");
  });

  it("source key namespaces the master copy under its display key", () => {
    expect(sourceKey(portraitKey("m-navi"))).toBe("src:portrait:m-navi");
    expect(sourceKey(bannerKey("Ruins"))).toBe("src:banner:ruins");
    // Never collides with a display key — that would overwrite the art itself.
    expect(sourceKey(portraitKey("m-navi"))).not.toBe(portraitKey("m-navi"));
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

  it("portrait prompt puts Subject first, then action/context/composition/style in order", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A flickering mote of light." },
      instr({
        action: "The pose is neutral.",
        context: "The background is white.",
        composition: "A waist-up portrait.",
        style: "Clean ink illustration.",
      }),
    );
    expect(p).toContain("Name: Navi.");
    expect(p).toContain("Species: sprite.");
    expect(p).toContain("Appearance: A flickering mote of light.");
    const order = [
      "Name: Navi.",
      "The pose is neutral.",
      "The background is white.",
      "A waist-up portrait.",
      "Clean ink illustration.",
    ].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("portrait prompt tolerates blank identity fields", () => {
    const p = buildPortraitPrompt(
      { name: "", species: "", description: "" },
      instr({ style: "style" }),
    );
    expect(p).toBe("style");
  });

  it("appends the reference instruction as the final line only when given", () => {
    const member = { name: "Navi", species: "sprite", description: "A mote." };
    const withRef = buildPortraitPrompt(member, instr({ style: "Ink." }), "Match the refs.");
    expect(withRef.endsWith("Match the refs.")).toBe(true);
    const withoutRef = buildPortraitPrompt(member, instr({ style: "Ink." }));
    expect(withoutRef).not.toContain("Match the refs.");
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
      instr({ style: "1-bit portrait." }),
    );
    expect(p).toBe("A neon fox in a trench coat.\n\n1-bit portrait.");
    expect(p).not.toContain("Name: Navi.");
    expect(p).not.toContain("Appearance:");
  });

  it("custom portrait prompt still gets the reference instruction last", () => {
    const p = buildPortraitPrompt(
      {
        name: "Navi",
        species: "sprite",
        description: "A mote.",
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "A neon fox.",
      },
      instr({ style: "Ink." }),
      "Match the refs.",
    );
    expect(p).toBe("A neon fox.\n\nInk.\n\nMatch the refs.");
  });

  it("falls back to auto lines when the custom flag is on but the prompt is blank", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A mote.", useCustomPortraitPrompt: true, customPortraitPrompt: "  " },
      instr({ style: "style" }),
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

describe("extractMessageText", () => {
  it("returns the assistant's words when it answered in text", () => {
    const json = { choices: [{ message: { content: "  I can't draw real people.  " } }] };
    expect(extractMessageText(json)).toBe("I can't draw real people.");
  });

  it("joins a parts-array reply", () => {
    const json = {
      choices: [{ message: { content: [{ text: "policy:" }, { text: "no." }, { foo: 1 }] } }],
    };
    expect(extractMessageText(json)).toBe("policy: no.");
  });

  it("is empty when the content IS the image, or there is none", () => {
    expect(extractMessageText({ choices: [{ message: { content: "data:image/png;base64,AA" } }] })).toBe("");
    expect(extractMessageText({ choices: [] })).toBe("");
    expect(extractMessageText(null)).toBe("");
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

describe("toOneBitBlob", () => {
  it('returns the blob untouched when mode is "off"', async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(toOneBitBlob(blob, 128, "off")).resolves.toBe(blob);
    // "off" keeps the raw model output — no decode, no resize.
    expect(decode).not.toHaveBeenCalled();
  });
});

describe("prepareUploadedImage", () => {
  it('still decodes when shading is "off" — uploads must not be stored raw', async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const decode = vi.fn().mockRejectedValue(new Error("no canvas"));
    vi.stubGlobal("createImageBitmap", decode);
    await expect(prepareUploadedImage(blob, 192, "off")).rejects.toThrow(ImageError);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("rejects a file the browser can't decode instead of storing it raw", async () => {
    // Storing an undecodable upload (HEIC off a phone) "succeeds" and then shows
    // a broken portrait no edit can ever repair — it has to fail at the door.
    const blob = dataUrlToBlob("data:image/heic;base64,AAAA");
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad file")));
    await expect(prepareUploadedImage(blob, 192, "threshold")).rejects.toThrow(
      /try a JPG, PNG, or WebP/,
    );
  });
});

describe("isModelSafeImage", () => {
  it("accepts what an image model takes as an input part", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      expect(isModelSafeImage(new Blob([], { type: mime }))).toBe(true);
    }
    expect(isModelSafeImage(new Blob([], { type: "IMAGE/PNG" }))).toBe(true);
  });

  it("rejects the formats a phone gallery hands over", () => {
    for (const mime of ["image/heic", "image/heif", "image/avif", "image/bmp", ""]) {
      expect(isModelSafeImage(new Blob([], { type: mime }))).toBe(false);
    }
  });
});

describe("uploadStoredWidth", () => {
  it("quantized modes keep the 1-bit pixel width", () => {
    expect(uploadStoredWidth(PORTRAIT_PIXEL_WIDTH, "threshold")).toBe(PORTRAIT_PIXEL_WIDTH);
    expect(uploadStoredWidth(PORTRAIT_PIXEL_WIDTH, "bayer4")).toBe(PORTRAIT_PIXEL_WIDTH);
  });

  it('shading "off" keeps a real display width — no pixel grid to snap to', () => {
    expect(uploadStoredWidth(PORTRAIT_PIXEL_WIDTH, "off")).toBe(UPLOAD_PLAIN_WIDTH);
    // Never smaller than what was asked for.
    expect(uploadStoredWidth(UPLOAD_PLAIN_WIDTH * 2, "off")).toBe(UPLOAD_PLAIN_WIDTH * 2);
  });
});

describe("exportScale", () => {
  it("blows a stored display copy up to at least the export width", () => {
    expect(exportScale(PORTRAIT_PIXEL_WIDTH)).toBe(6); // 192 → 1152
    expect(exportScale(256)).toBe(4); // banner 256 → 1024
    expect(PORTRAIT_PIXEL_WIDTH * exportScale(PORTRAIT_PIXEL_WIDTH)).toBeGreaterThanOrEqual(
      EXPORT_MIN_WIDTH,
    );
  });

  it("leaves an already-large image alone", () => {
    expect(exportScale(EXPORT_MIN_WIDTH)).toBe(1);
    expect(exportScale(2048)).toBe(1);
  });

  it("is a whole number, so every stored pixel maps to an exact square", () => {
    for (const w of [7, 100, 192, 256, 333, 1023]) {
      expect(Number.isInteger(exportScale(w))).toBe(true);
      expect(exportScale(w)).toBeGreaterThanOrEqual(1);
    }
  });

  it("survives a nonsense width", () => {
    expect(exportScale(0)).toBe(1);
    expect(exportScale(-5)).toBe(1);
    expect(exportScale(Number.NaN)).toBe(1);
  });
});

describe("toExportBlob / toSourceBlob", () => {
  it("both survive an image that can't be decoded", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("no canvas")));
    // Saving a file and keeping a master are both best-effort — neither may
    // turn an undecodable blob into a failure.
    await expect(toExportBlob(blob)).resolves.toBe(blob);
    // A PNG is still safe to post back as an edit source even undecoded here.
    await expect(toSourceBlob(blob)).resolves.toBe(blob);
  });

  it("keeps NO master for an undecodable, model-hostile file", async () => {
    // The alternative — storing the HEIC — is what made every later edit of an
    // uploaded portrait fail on the wire. No master falls back to the display
    // copy, which is always canvas-encoded PNG.
    const blob = dataUrlToBlob("data:image/heic;base64,AAAA");
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("no canvas")));
    await expect(toSourceBlob(blob)).resolves.toBeNull();
  });

  it("keeps a master that already fits the box as-is", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 512, height: 768, close }),
    );
    await expect(toSourceBlob(blob, 1024)).resolves.toBe(blob);
    expect(close).toHaveBeenCalled();
  });

  it("passes an already-large image straight through the export", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1600, height: 900, close }),
    );
    await expect(toExportBlob(blob)).resolves.toBe(blob);
    expect(close).toHaveBeenCalled();
  });
});

describe("imageRequestKey", () => {
  it("prefers the dedicated image key when set", () => {
    expect(imageRequestKey({ openRouterKey: "sk-main", imageKey: "sk-img" } as Settings)).toBe(
      "sk-img",
    );
  });

  it("falls back to the main key when the image key is blank", () => {
    expect(imageRequestKey({ openRouterKey: "sk-main", imageKey: "  " } as Settings)).toBe(
      "sk-main",
    );
    expect(imageRequestKey({ openRouterKey: "sk-main" } as Settings)).toBe("sk-main");
  });

  it("trims the returned key", () => {
    expect(imageRequestKey({ openRouterKey: "sk-main", imageKey: " sk-img " } as Settings)).toBe(
      "sk-img",
    );
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("text-only generation sends a plain string content and no image_config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "a tower" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toBe("a tower");
    expect(body.image_config).toBeUndefined();
    expect(body.modalities).toEqual(["image", "text"]);
  });

  it("authorizes with the dedicated image key when set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({
      settings: { ...settings, imageKey: "sk-img" },
      prompt: "a tower",
    });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-img");
  });

  it("sends image_url parts before the text part, in order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({
      settings,
      prompt: "a portrait",
      images: ["data:image/png;base64,BBBB", "data:image/jpeg;base64,CCCC"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,CCCC" } },
      { type: "text", text: "a portrait" },
    ]);
  });

  it("forwards aspectRatio as image_config.aspect_ratio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "a portrait", aspectRatio: "2:3" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.image_config).toEqual({ aspect_ratio: "2:3" });
    expect(body.image_size).toBeUndefined();
  });

  it("retries a 429 with backoff and then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce(reply);
    vi.stubGlobal("fetch", fetchMock);
    const pending = generateImage({ settings, prompt: "a tower" });
    await vi.advanceTimersByTimeAsync(1000);
    const blob = await pending;
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImage({ settings, prompt: "a tower" })).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("soft-retries exactly once when a 200 carries no image", async () => {
    const textOnly = {
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "sorry, words only" } }] }),
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(textOnly).mockResolvedValueOnce(reply);
    vi.stubGlobal("fetch", fetchMock);
    const blob = await generateImage({ settings, prompt: "a tower" });
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const alwaysText = vi.fn().mockResolvedValue(textOnly);
    vi.stubGlobal("fetch", alwaysText);
    // The model's own words are the diagnosis — quote them, don't discard them.
    await expect(generateImage({ settings, prompt: "a tower" })).rejects.toThrow(
      "sorry, words only",
    );
    expect(alwaysText).toHaveBeenCalledTimes(2);
  });

  it("falls back to a plain message when the text-only reply is empty", async () => {
    const empty = { ok: true, json: () => Promise.resolve({ choices: [{ message: {} }] }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(empty));
    await expect(generateImage({ settings, prompt: "a tower" })).rejects.toThrow(
      "No image returned",
    );
  });

  it("surfaces a settings-aware message on a payload-size failure with references", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      generateImage({ settings, prompt: "a portrait", images: ["data:image/png;base64,BBBB"] }),
    ).rejects.toThrow(/reference image/);
  });
});
