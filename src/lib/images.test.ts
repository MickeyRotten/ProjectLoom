import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPortraitPrompt,
  dataUrlToBlob,
  extractImageDataUrl,
  extractMessageText,
  generateImage,
  ImageError,
  imageRequestKey,
  imagesAllowed,
  joinPromptParts,
  LEGACY_MASTER_PREFIX,
  MAX_IMAGE_SIDE,
  portraitKey,
  slotArtPairs,
  slotArtPrefixes,
  slotImageKeys,
  slotScopedKey,
  toStoredImage,
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

  it("keeps the retired master prefix named, for the migration that folds it in", () => {
    // Nothing writes it any more; `db.ts → promoteLegacyMasters` reads it once.
    expect(LEGACY_MASTER_PREFIX).toBe("src:");
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
});

describe("slotArtPairs", () => {
  const cast = (...ids: string[]) => ids.map((id) => ({ id, name: id }) as Character);

  it("pairs each character's portrait with the slot's copy of it", () => {
    expect(slotArtPairs("s1", cast("pc"))).toEqual([
      { live: "portrait:pc", slot: "slot:s1:portrait:pc" },
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
    const mine = slotArtPairs("s1", cast("pc")).map((a) => a.slot);
    // A build that wrote masters left `src:slot:s1:…` blobs behind; dropping the
    // slot has to take those too, since no live key names them any more.
    for (const key of [...mine, `${LEGACY_MASTER_PREFIX}slot:s1:portrait:pc`]) {
      expect(prefixes.some((p) => key.startsWith(p))).toBe(true);
    }
    const other = slotArtPairs("s2", cast("pc")).map((a) => a.slot);
    for (const key of [...other, portraitKey("pc")]) {
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

  it("survives a slot written before the cast lived in the game", () => {
    // Pulled from the cloud, so the shape is whatever an older build wrote.
    const legacy = { id: "s1", game: {} as unknown as GameState };
    expect(slotImageKeys(legacy)).toEqual([]);
  });
});

describe("prompt builders", () => {
  it("portrait prompt puts Subject first, then action/context/composition/style in order", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite" },
      "A flickering mote of light.",
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
      { name: "Navi", species: "sprite", sex: "female" },
      "A mote.",
      tpl({ portraitStyle: "Ink." }),
    );
    expect(withSex).toContain("Species: sprite. Sex: female.");
    const withoutSex = buildPortraitPrompt(
      { name: "Navi", species: "sprite", sex: "  " },
      "A mote.",
      tpl({ portraitStyle: "Ink." }),
    );
    expect(withoutSex).not.toContain("Sex:");
  });

  it("portrait prompt tolerates blank identity fields", () => {
    const p = buildPortraitPrompt(
      { name: "", species: "" },
      "",
      tpl({ portraitStyle: "style" }),
    );
    expect(p).toBe("style");
  });

  it("appends the reference instruction as the final line only when given", () => {
    const member = { name: "Navi", species: "sprite" };
    const template = tpl({ portraitStyle: "Ink.", portraitRefInstruction: "Match the refs." });
    const withRef = buildPortraitPrompt(member, "A mote.", template, true);
    expect(withRef.endsWith("Match the refs.")).toBe(true);
    const withoutRef = buildPortraitPrompt(member, "A mote.", template);
    expect(withoutRef).not.toContain("Match the refs.");
  });

  it("custom portrait prompt replaces the auto identity/appearance lines", () => {
    const p = buildPortraitPrompt(
      {
        name: "Navi",
        species: "sprite",
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "A neon fox in a trench coat.",
      },
      "A flickering mote.",
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
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "A neon fox.",
      },
      "A mote.",
      tpl({ portraitStyle: "Ink.", portraitRefInstruction: "Match the refs." }),
      true,
    );
    expect(p).toBe("A neon fox.\n\nInk.\n\nMatch the refs.");
  });

  it("falls back to auto lines when the custom flag is on but the prompt is blank", () => {
    const p = buildPortraitPrompt(
      { name: "Navi", species: "sprite", useCustomPortraitPrompt: true, customPortraitPrompt: "  " },
      "A mote.",
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
      },
      "long white hair, red eyes.",
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
        useCustomPortraitPrompt: true,
        customPortraitPrompt: "1girl, neon fox,",
      },
      "A mote.",
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
});

describe("extractImageDataUrl", () => {
  const dataUrl = "data:image/png;base64,AAAA";

  it("reads data[0].b64_json paired with media_type", () => {
    const json = { data: [{ b64_json: "AAAA", media_type: "image/png" }] };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("falls back to image/png when media_type is missing", () => {
    const json = { data: [{ b64_json: "AAAA" }] };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("takes the first entry when several come back", () => {
    const json = {
      data: [
        { b64_json: "AAAA", media_type: "image/png" },
        { b64_json: "BBBB", media_type: "image/jpeg" },
      ],
    };
    expect(extractImageDataUrl(json)).toBe(dataUrl);
  });

  it("returns null when there is no image", () => {
    expect(extractImageDataUrl({ data: [{}] })).toBeNull();
    expect(extractImageDataUrl({ data: [] })).toBeNull();
    expect(extractImageDataUrl({})).toBeNull();
    expect(extractImageDataUrl(null)).toBeNull();
  });
});

describe("extractMessageText", () => {
  it("returns an error.message that rides along a 200", () => {
    const json = { error: { message: "  I can't draw real people.  " } };
    expect(extractMessageText(json)).toBe("I can't draw real people.");
  });

  it("is empty when there is no error", () => {
    expect(extractMessageText({ data: [{ b64_json: "AAAA" }] })).toBe("");
    expect(extractMessageText({})).toBe("");
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

describe("toStoredImage", () => {
  const decodes = (width: number, height: number) => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width, height, close }));
    return close;
  };

  it("stores an image inside the box exactly as it came", async () => {
    // No quantize, no resize, no re-encode: a generated PNG keeps its own bytes.
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const close = decodes(512, 768);
    await expect(toStoredImage(blob)).resolves.toBe(blob);
    expect(close).toHaveBeenCalled();
  });

  it("never enlarges — the bound is a ceiling, not a target", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    decodes(64, 96);
    await expect(toStoredImage(blob, MAX_IMAGE_SIDE)).resolves.toBe(blob);
  });

  it("keeps a generated image rather than failing when it can't be decoded", async () => {
    // Lenient by default: the image pipeline is fire-and-forget, and an
    // unprocessed picture beats no picture at all.
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("no canvas")));
    await expect(toStoredImage(blob)).resolves.toBe(blob);
  });

  it("rejects an undecodable UPLOAD instead of storing it raw", async () => {
    // Storing a HEIC off a phone "succeeds" and then shows a portrait that never
    // loads, with no way to tell why — it has to fail at the door.
    const blob = dataUrlToBlob("data:image/heic;base64,AAAA");
    const decode = vi.fn().mockRejectedValue(new Error("bad file"));
    vi.stubGlobal("createImageBitmap", decode);
    await expect(toStoredImage(blob, MAX_IMAGE_SIDE, true)).rejects.toThrow(ImageError);
    await expect(toStoredImage(blob, MAX_IMAGE_SIDE, true)).rejects.toThrow(
      /try a JPG, PNG, or WebP/,
    );
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("bounds the longest side, whichever side that is", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    const drawn: { w: number; h: number }[] = [];
    const canvases: { width: number; height: number }[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 2000, close: vi.fn() }));
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: false,
            fillStyle: "",
            fillRect: () => {},
            drawImage: (_src: unknown, _x: number, _y: number, w: number, h: number) =>
              drawn.push({ w, h }),
          }),
          toBlob: (cb: (b: Blob | null) => void) =>
            cb(new Blob(["x"], { type: "image/jpeg" })),
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    const out = await toStoredImage(blob, 1024);
    expect(out.type).toBe("image/jpeg");
    // The final draw lands on the bounded size, 2:1 kept.
    expect(drawn.at(-1)).toEqual({ w: 1024, h: 512 });
    // And it got there by halving first, rather than in one aliasing jump.
    expect(drawn.length).toBeGreaterThan(1);
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

});

describe("generateImage dispatch", () => {
  const base = { openRouterKey: "sk-test", imageModelId: "m" } as Settings;
  const orReply = {
    ok: true,
    json: () => Promise.resolve({ data: [{ b64_json: "AAAA", media_type: "image/png" }] }),
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
    json: () => Promise.resolve({ data: [{ b64_json: "AAAA", media_type: "image/png" }] }),
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends a bare prompt and no input_references when there are no reference images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "a tower" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/images");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe("a tower");
    expect(body.model).toBe("google/gemini-2.5-flash-image");
    expect(body.input_references).toBeUndefined();
    expect(body.aspect_ratio).toBeUndefined();
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

  it("sends reference images as input_references, in order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({
      settings,
      prompt: "a portrait",
      images: ["data:image/png;base64,BBBB", "data:image/jpeg;base64,CCCC"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe("a portrait");
    expect(body.input_references).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,CCCC" } },
    ]);
  });

  it("forwards aspectRatio as a top-level aspect_ratio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ settings, prompt: "a portrait", aspectRatio: "2:3" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.aspect_ratio).toBe("2:3");
    expect(body.image_config).toBeUndefined();
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
      json: () => Promise.resolve({ error: { message: "sorry, words only" } }),
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

  it("falls back to a plain message when there is no explanation at all", async () => {
    const empty = { ok: true, json: () => Promise.resolve({}) };
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
