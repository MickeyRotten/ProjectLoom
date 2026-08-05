import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blobToDataUrl,
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
  imagesAllowed,
  imageEditAllowed,
  isModelSafeImage,
  joinPromptParts,
  PORTRAIT_PIXEL_WIDTH,
  portraitKey,
  prepareUploadedImage,
  slotArtPairs,
  slotArtPrefixes,
  slotImageKeys,
  slotScopedKey,
  sourceKey,
  toExportBlob,
  toOneBitBlob,
  toSourceBlob,
  UPLOAD_PLAIN_WIDTH,
  uploadStoredWidth,
} from "./images";
import { DEFAULT_COMFY } from "./comfyui";
import { newGame } from "./defaults";
import type { Character, GameState, ImagePromptTemplate, Settings } from "../types";

/** A template with every field blank — each test fills only what it asserts on. */
function tpl(overrides: Partial<ImagePromptTemplate> = {}): ImagePromptTemplate {
  return {
    id: "t",
    name: "Test",
    format: "prose",
    portraitAction: "",
    portraitContext: "",
    portraitComposition: "",
    portraitStyle: "",
    portraitRefInstruction: "",
    negativePrompt: "",
    appearanceInstructions: "",
    ...overrides,
  };
}

// Several suites stub globals (fetch, createImageBitmap) — never leak one.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cache keys", () => {
  it("portrait key is the raw member id", () => {
    expect(portraitKey("m-navi")).toBe("portrait:m-navi");
  });

  it("source key namespaces the master copy under its display key", () => {
    expect(sourceKey(portraitKey("m-navi"))).toBe("src:portrait:m-navi");
    // Never collides with a display key — that would overwrite the art itself.
    expect(sourceKey(portraitKey("m-navi"))).not.toBe(portraitKey("m-navi"));
  });
});

describe("slot-scoped keys", () => {
  it("namespaces a live key under the slot that froze it", () => {
    expect(slotScopedKey("s1", portraitKey("m-navi"))).toBe("slot:s1:portrait:m-navi");
    // Never collides with the live key — that IS the bug being fixed.
    expect(slotScopedKey("s1", portraitKey("m-navi"))).not.toBe(portraitKey("m-navi"));
    // Nor with another slot's copy of the same character.
    expect(slotScopedKey("s2", portraitKey("m-navi"))).not.toBe(
      slotScopedKey("s1", portraitKey("m-navi")),
    );
  });

  it("keeps the master outside the scope", () => {
    // `sourceKey` wraps the scoped key, so it keeps its one meaning: the master
    // of the key it wraps.
    expect(sourceKey(slotScopedKey("s1", portraitKey("m-navi")))).toBe(
      "src:slot:s1:portrait:m-navi",
    );
  });
});

describe("slotArtPairs", () => {
  const cast = (...ids: string[]) => ids.map((id) => ({ id, name: id }) as Character);

  it("pairs each character's portrait and master with the slot's copy", () => {
    expect(slotArtPairs("s1", cast("pc"))).toEqual([
      {
        display: { live: "portrait:pc", slot: "slot:s1:portrait:pc" },
        master: { live: "src:portrait:pc", slot: "src:slot:s1:portrait:pc" },
      },
    ]);
  });

  it("covers the whole cast and nobody else", () => {
    expect(slotArtPairs("s1", cast("pc", "m-navi"))).toHaveLength(2);
    expect(slotArtPairs("s1", [])).toEqual([]);
    // Slot documents pulled from the cloud may have no cast at all.
    expect(slotArtPairs("s1", undefined)).toEqual([]);
  });

  it("sweeps its own keys and nothing else", () => {
    const prefixes = slotArtPrefixes("s1");
    const mine = slotArtPairs("s1", cast("pc")).flatMap((a) => [a.display.slot, a.master.slot]);
    for (const key of mine) expect(prefixes.some((p) => key.startsWith(p))).toBe(true);
    const other = slotArtPairs("s2", cast("pc")).flatMap((a) => [a.display.slot, a.master.slot]);
    for (const key of [...other, portraitKey("pc"), sourceKey(portraitKey("pc"))]) {
      expect(prefixes.some((p) => key.startsWith(p))).toBe(false);
    }
  });
});

describe("slotImageKeys", () => {
  const cast = (...ids: string[]) => ids.map((id) => ({ id, name: id }) as Character);
  const saved = (id: string, patch: Partial<GameState>) => ({
    id,
    game: { ...newGame(), ...patch },
  });

  it("names the cast's FROZEN portraits", () => {
    // The slot's own copies, so a pull cannot overwrite the live game's art.
    const slot = saved("s1", { characters: cast("pc", "m-navi") });
    expect(slotImageKeys(slot).sort()).toEqual(
      ["slot:s1:portrait:m-navi", "slot:s1:portrait:pc"].sort(),
    );
  });

  it("leaves the masters out — a restore needs the picture, not the negative", () => {
    const slot = saved("s1", { characters: cast("pc") });
    expect(slotImageKeys(slot).some((k) => k.startsWith("src:"))).toBe(false);
  });

  it("survives a slot written before the cast lived in the game", () => {
    // Pulled from the cloud, so the shape is whatever an older build wrote.
    const legacy = { id: "s1", game: {} as unknown as GameState };
    expect(slotImageKeys(legacy)).toEqual([]);
  });
});

describe("prompt builders", () => {
  it("portrait prompt puts Subject first, then action/context/composition/style in order", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A flickering mote of light." },
      tpl({
        portraitAction: "The pose is neutral.",
        portraitContext: "The background is white.",
        portraitComposition: "A waist-up portrait.",
        portraitStyle: "Clean ink illustration.",
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

  it("portrait prompt carries Sex after Species, and omits it when blank", () => {
    const withSex = buildPortraitPrompt(
      { name: "Navi", species: "sprite", sex: "female", description: "A mote." },
      tpl({ portraitStyle: "Ink." }),
    );
    expect(withSex).toContain("Species: sprite. Sex: female.");
    const withoutSex = buildPortraitPrompt(
      { name: "Navi", species: "sprite", sex: "  ", description: "A mote." },
      tpl({ portraitStyle: "Ink." }),
    );
    expect(withoutSex).not.toContain("Sex:");
  });

  it("portrait prompt tolerates blank identity fields", () => {
    const p = buildPortraitPrompt(
      { name: "", species: "", description: "" },
      tpl({ portraitStyle: "style" }),
    );
    expect(p).toBe("style");
  });

  it("appends the reference instruction as the final line only when given", () => {
    const member = { name: "Navi", species: "sprite", description: "A mote." };
    const template = tpl({ portraitStyle: "Ink.", portraitRefInstruction: "Match the refs." });
    const withRef = buildPortraitPrompt(member, template, true);
    expect(withRef.endsWith("Match the refs.")).toBe(true);
    const withoutRef = buildPortraitPrompt(member, template);
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
      tpl({ portraitStyle: "1-bit portrait." }),
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
      tpl({ portraitStyle: "Ink.", portraitRefInstruction: "Match the refs." }),
      true,
    );
    expect(p).toBe("A neon fox.\n\nInk.\n\nMatch the refs.");
  });

  it("falls back to auto lines when the custom flag is on but the prompt is blank", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", description: "A mote.", useCustomPortraitPrompt: true, customPortraitPrompt: "  " },
      tpl({ portraitStyle: "style" }),
    );
    expect(p).toContain("Name: Navi.");
  });

  it("a tags portrait comma-joins, drops the labels, and leaves the NAME out", () => {
    const p = buildPortraitPrompt(
      {
        name: "Navi",
        species: "sprite",
        sex: "female",
        description: "long white hair, red eyes.",
      },
      tpl({
        format: "tags",
        portraitAction: "standing, arms at sides",
        portraitComposition: "solo, upper body",
        portraitStyle: "monochrome, lineart",
      }),
    );
    // The name would cost tokens a text encoder can do nothing with.
    expect(p).not.toContain("Navi");
    expect(p).not.toContain("Species:");
    expect(p).toBe(
      "sprite, female, long white hair, red eyes, standing, arms at sides, solo, upper body, monochrome, lineart",
    );
  });

  it("a tags custom prompt is joined the same way", () => {
    const p = buildPortraitPrompt(
      {
        name: "Navi",
        species: "sprite",
        description: "A mote.",
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "1girl, neon fox,",
      },
      tpl({ format: "tags", portraitStyle: "monochrome" }),
    );
    expect(p).toBe("1girl, neon fox, monochrome");
  });

  it("joinPromptParts drops blanks in both formats", () => {
    expect(joinPromptParts(["a", "  ", "b"], "prose")).toBe("a\n\nb");
    expect(joinPromptParts(["a.", " ", "b;"], "tags")).toBe("a, b");
    // A part that is nothing BUT punctuation disappears rather than leaving a
    // stray separator behind.
    expect(joinPromptParts(["a", ".", "b"], "tags")).toBe("a, b");
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
    expect(exportScale(256)).toBe(4); // 256 → 1024
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

describe("generation gate", () => {
  it("images are allowed while the master switch is on", () => {
    expect(imagesAllowed({ imagesEnabled: true })).toBe(true);
    expect(imagesAllowed({ imagesEnabled: false })).toBe(false);
  });

  it("a save written before the switch existed keeps drawing", () => {
    // Absent means "played with images on" — the only reading that doesn't
    // silently switch a feature off under an existing game.
    expect(imagesAllowed({} as { imagesEnabled: boolean })).toBe(true);
  });

  it("an edit needs the master switch AND a backend that can edit", () => {
    expect(imageEditAllowed({ imagesEnabled: true, imageBackend: "openrouter" })).toBe(true);
    expect(imageEditAllowed({ imagesEnabled: true, imageBackend: "comfyui" })).toBe(false);
    expect(imageEditAllowed({ imagesEnabled: false, imageBackend: "openrouter" })).toBe(false);
    // A save from before the backend existed reads as OpenRouter, which is what
    // it was played with.
    expect(imageEditAllowed({ imagesEnabled: true } as Settings)).toBe(true);
  });
});

describe("generateImage dispatch", () => {
  const base = { openRouterKey: "sk-test", imageModelId: "m" } as Settings;
  const orReply = {
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] } }],
      }),
  };

  afterEach(() => vi.unstubAllGlobals());

  it("goes to OpenRouter by default — including for a save with no backend field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(orReply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings: base, prompt: "a tower" });
    expect(fetchMock.mock.calls[0][0]).toContain("openrouter.ai");
  });

  it("goes to ComfyUI when the backend says so, and sends OpenRouter nothing", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/prompt")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prompt_id: "p1" }) });
      }
      if (url.includes("/history/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              p1: {
                outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } },
                status: { status_str: "success", completed: true },
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const settings = {
      ...base,
      ...DEFAULT_COMFY,
      imageBackend: "comfyui",
      comfyUrl: "http://box:8188",
    } as Settings;
    await generateImage({ settings, prompt: "a tower" });

    const hosts = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(hosts.every((h) => h.startsWith("http://box:8188"))).toBe(true);
    expect(hosts.some((h) => h.includes("openrouter.ai"))).toBe(false);
  });

  it("does not demand an OpenRouter key for the ComfyUI path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "", text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) }),
    );
    const settings = {
      ...DEFAULT_COMFY,
      openRouterKey: "",
      imageBackend: "comfyui",
    } as Settings;
    // Fails on ComfyUI's own terms, never on the missing key.
    await expect(generateImage({ settings, prompt: "x" })).rejects.not.toThrow(/API key/);
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
