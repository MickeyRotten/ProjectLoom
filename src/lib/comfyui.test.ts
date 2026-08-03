import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMFY_TIMEOUT_MS,
  DEFAULT_COMFY,
  DEFAULT_COMFY_WORKFLOW,
  comfyDimensions,
  comfyExecutionError,
  comfyMime,
  comfyPromptError,
  comfyViewUrl,
  fetchComfyOptions,
  firstComfyImage,
  generateComfyImage,
  normalizeComfy,
  normalizeComfyUrl,
  parseComfyEntry,
  pingComfy,
  substituteWorkflow,
  validateWorkflow,
  workflowValues,
} from "./comfyui";
import { ImageError } from "./imageError";
import type { Settings } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* --------------------------- workflow templating -------------------------- */

describe("substituteWorkflow", () => {
  it("replaces the QUOTED token, so a string keeps its quotes and a number loses them", () => {
    const out = substituteWorkflow('{"text": "%prompt%", "steps": "%steps%"}', {
      prompt: "a tower",
      steps: 25,
    });
    expect(out).toBe('{"text": "a tower", "steps": 25}');
    expect(JSON.parse(out)).toEqual({ text: "a tower", steps: 25 });
  });

  it("escapes quotes and newlines in the prompt rather than breaking the document", () => {
    const out = substituteWorkflow('{"text": "%prompt%"}', {
      prompt: 'a "grand" hall\nlit by torches',
    });
    expect(JSON.parse(out)).toEqual({ text: 'a "grand" hall\nlit by torches' });
  });

  it("replaces every occurrence, not just the first", () => {
    const out = substituteWorkflow('{"a": "%seed%", "b": "%seed%"}', { seed: 7 });
    expect(out).toBe('{"a": 7, "b": 7}');
  });

  it("leaves an unsupplied token alone", () => {
    expect(substituteWorkflow('{"a": "%vae%"}', { prompt: "x" })).toBe('{"a": "%vae%"}');
  });

  it("does not touch a bare unquoted token — the quotes are part of the contract", () => {
    expect(substituteWorkflow('{"a": %prompt%}', { prompt: "x" })).toBe('{"a": %prompt%}');
  });

  it("fills the shipped workflow into valid JSON", () => {
    const values = workflowValues(DEFAULT_COMFY, "a tower", "blurry", { width: 1024, height: 1024 }, 5);
    const graph = JSON.parse(substituteWorkflow(DEFAULT_COMFY_WORKFLOW, values));
    expect(graph["6"].inputs.text).toBe("a tower");
    expect(graph["7"].inputs.text).toBe("blurry");
    expect(graph["3"].inputs.seed).toBe(5);
    expect(graph["3"].inputs.steps).toBe(DEFAULT_COMFY.comfySteps);
    expect(graph["3"].inputs.cfg).toBe(DEFAULT_COMFY.comfyScale);
    expect(graph["5"].inputs.width).toBe(1024);
  });
});

describe("workflowValues", () => {
  it("sends clip skip negative, as CLIPSetLastLayer counts it", () => {
    const values = workflowValues({ ...DEFAULT_COMFY, comfyClipSkip: 2 }, "x", "", {
      width: 64,
      height: 64,
    });
    expect(values.clip_skip).toBe(-2);
  });

  it("maps CFG onto %scale%, which is what SillyTavern workflows call it", () => {
    const values = workflowValues({ ...DEFAULT_COMFY, comfyScale: 4.5 }, "x", "", {
      width: 64,
      height: 64,
    });
    expect(values.scale).toBe(4.5);
  });
});

describe("validateWorkflow", () => {
  it("accepts the shipped workflow", () => {
    expect(validateWorkflow(DEFAULT_COMFY_WORKFLOW)).toBeNull();
  });

  it("rejects a workflow with no prompt placeholder", () => {
    expect(validateWorkflow('{"1": {"class_type": "X", "inputs": {}}}')).toMatch(/%prompt%/);
  });

  it("rejects malformed JSON", () => {
    expect(validateWorkflow('{"1": "%prompt%",}')).toMatch(/valid JSON/);
  });

  it("rejects an array — the API format is an object of nodes", () => {
    expect(validateWorkflow('["%prompt%"]')).toMatch(/object of nodes/);
  });

  it("rejects blank", () => {
    expect(validateWorkflow("   ")).toMatch(/empty/);
  });

  it("validates the SUBSTITUTED text, so an unquoted numeric token fails here", () => {
    // Valid-looking template, but `"cfg": %scale%` becomes `"cfg": ` — the kind
    // of hand-edit that would otherwise fail invisibly at generation time.
    expect(validateWorkflow('{"1": {"inputs": {"text": "%prompt%", "cfg": %scale%}}}')).toMatch(
      /valid JSON/,
    );
  });
});

/* -------------------------------- sizing --------------------------------- */

describe("comfyDimensions", () => {
  it("passes the configured size through when no ratio is asked for", () => {
    expect(comfyDimensions(1024, 768)).toEqual({ width: 1024, height: 768 });
  });

  it("reshapes to 2:3 at roughly the same pixel area", () => {
    const { width, height } = comfyDimensions(1024, 1024, "2:3");
    expect(width / height).toBeCloseTo(2 / 3, 1);
    expect(width * height).toBeGreaterThan(1024 * 1024 * 0.9);
    expect(width * height).toBeLessThan(1024 * 1024 * 1.1);
  });

  it("snaps every side to a multiple of 64", () => {
    const { width, height } = comfyDimensions(1000, 1000, "2:3");
    expect(width % 64).toBe(0);
    expect(height % 64).toBe(0);
  });

  it("falls back to the configured size on an unusable ratio", () => {
    expect(comfyDimensions(512, 512, "nonsense")).toEqual({ width: 512, height: 512 });
    expect(comfyDimensions(512, 512, "0:3")).toEqual({ width: 512, height: 512 });
  });

  it("never returns zero", () => {
    expect(comfyDimensions(1, 1).width).toBeGreaterThanOrEqual(64);
  });
});

/* --------------------------------- urls ---------------------------------- */

describe("urls", () => {
  it("strips trailing slashes and falls back when blank", () => {
    expect(normalizeComfyUrl("http://host:8188/")).toBe("http://host:8188");
    expect(normalizeComfyUrl("  ")).toBe("http://127.0.0.1:8188");
  });

  it("encodes the view query — a filename with a space must survive", () => {
    const url = comfyViewUrl("http://host:8188", {
      filename: "My Loom 001.png",
      subfolder: "a b",
      type: "output",
    });
    expect(url).toContain("filename=My+Loom+001.png");
    expect(url).toContain("subfolder=a+b");
    expect(new URL(url).searchParams.get("filename")).toBe("My Loom 001.png");
  });
});

describe("comfyMime", () => {
  it("reads the type off the extension", () => {
    expect(comfyMime("a.png")).toBe("image/png");
    expect(comfyMime("a.JPG")).toBe("image/jpeg");
    expect(comfyMime("a.webp")).toBe("image/webp");
    expect(comfyMime("noextension")).toBe("image/png");
  });
});

/* ------------------------------- responses ------------------------------- */

const imageOut = {
  outputs: { "9": { images: [{ filename: "Loom_001_.png", subfolder: "", type: "output" }] } },
  status: { status_str: "success", completed: true },
};

describe("parseComfyEntry", () => {
  it("treats an empty map as pending", () => {
    expect(parseComfyEntry({}, "p1")).toEqual({ done: false, error: null, image: null });
  });

  it("unwraps the prompt-id-keyed map", () => {
    const res = parseComfyEntry({ p1: imageOut }, "p1");
    expect(res.done).toBe(true);
    expect(res.image).toEqual({ filename: "Loom_001_.png", subfolder: "", type: "output" });
  });

  it("ignores an entry for a different prompt", () => {
    expect(parseComfyEntry({ other: imageOut }, "p1").done).toBe(false);
  });

  it("reports which node failed", () => {
    const res = parseComfyEntry(
      {
        p1: {
          status: {
            status_str: "error",
            messages: [
              [
                "execution_error",
                {
                  node_id: "4",
                  node_type: "CheckpointLoaderSimple",
                  exception_type: "ValueError",
                  exception_message: "value not in list",
                },
              ],
            ],
          },
        },
      },
      "p1",
    );
    expect(res.done).toBe(true);
    expect(res.error).toBe("CheckpointLoaderSimple [4] ValueError: value not in list");
  });

  it("calls a completed job with no images a failure, naming the cause", () => {
    const res = parseComfyEntry({ p1: { outputs: {}, status: { completed: true } } }, "p1");
    expect(res.done).toBe(true);
    expect(res.error).toMatch(/SaveImage/);
  });

  it("stays pending while an incomplete entry has no images yet", () => {
    expect(parseComfyEntry({ p1: { outputs: {} } }, "p1").done).toBe(false);
  });
});

describe("firstComfyImage", () => {
  it("skips output nodes that carry no images", () => {
    const img = firstComfyImage({
      "7": { text: ["nope"] },
      "9": { images: [{ filename: "a.png" }] },
    });
    expect(img).toEqual({ filename: "a.png", subfolder: "", type: "output" });
  });

  it("returns null when nothing saved an image", () => {
    expect(firstComfyImage({ "7": { text: ["x"] } })).toBeNull();
    expect(firstComfyImage(null)).toBeNull();
  });
});

describe("comfyPromptError / comfyExecutionError", () => {
  it("names the rejected node alongside the message", () => {
    const why = comfyPromptError({
      error: { message: "Prompt outputs failed validation" },
      node_errors: { "4": { class_type: "CheckpointLoaderSimple" } },
    });
    expect(why).toBe("Prompt outputs failed validation — CheckpointLoaderSimple [4]");
  });

  it("is null for a response carrying no error", () => {
    expect(comfyPromptError({ prompt_id: "x" })).toBeNull();
    expect(comfyExecutionError({ status: { status_str: "success" } })).toBeNull();
  });
});

/* ------------------------------ normalization ---------------------------- */

describe("normalizeComfy", () => {
  it("defaults everything when nothing is stored", () => {
    expect(normalizeComfy(undefined)).toEqual(DEFAULT_COMFY);
  });

  it("clamps the numbers into a usable range", () => {
    const s = normalizeComfy({
      comfySteps: 9999,
      comfyScale: -4,
      comfyWidth: 3,
      comfyHeight: 99999,
      comfyDenoise: 5,
      comfyClipSkip: 0,
    });
    expect(s.comfySteps).toBe(150);
    expect(s.comfyScale).toBe(0);
    expect(s.comfyWidth).toBe(64);
    expect(s.comfyHeight).toBe(4096);
    expect(s.comfyDenoise).toBe(1);
    expect(s.comfyClipSkip).toBe(1);
  });

  it("snaps sides to a multiple of 8", () => {
    expect(normalizeComfy({ comfyWidth: 1000 }).comfyWidth % 8).toBe(0);
  });

  it("survives junk of the wrong type", () => {
    const s = normalizeComfy({
      comfySteps: "twenty" as unknown as number,
      comfySampler: 5 as unknown as string,
    });
    expect(s.comfySteps).toBe(DEFAULT_COMFY.comfySteps);
    expect(s.comfySampler).toBe(DEFAULT_COMFY.comfySampler);
  });

  it("falls an unrecognised backend back to OpenRouter", () => {
    expect(normalizeComfy({ imageBackend: "midjourney" as never }).imageBackend).toBe(
      "openrouter",
    );
    expect(normalizeComfy({ imageBackend: "comfyui" }).imageBackend).toBe("comfyui");
  });

  it("restores the shipped workflow when the stored one is blank, but keeps a broken one", () => {
    expect(normalizeComfy({ comfyWorkflow: "   " }).comfyWorkflow).toBe(DEFAULT_COMFY_WORKFLOW);
    // A player's half-finished edit is theirs — the editor shows the error.
    expect(normalizeComfy({ comfyWorkflow: "{oops" }).comfyWorkflow).toBe("{oops");
  });
});

/* ------------------------------- generation ------------------------------ */

const settings = { ...DEFAULT_COMFY, imageBackend: "comfyui" } as Settings;

function jsonRes(data: unknown, ok = true, status = 200) {
  return { ok, status, statusText: "", json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

function blobRes(blob: Blob) {
  return { ok: true, status: 200, statusText: "", blob: () => Promise.resolve(blob) };
}

/** queue → N pending polls → the finished job → the image. */
function stubRun(pending = 0, blob = new Blob(["png"], { type: "image/png" })) {
  const calls: string[] = [];
  let polls = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    void init;
    calls.push(url);
    if (url.includes("/prompt")) return Promise.resolve(jsonRes({ prompt_id: "p1" }));
    if (url.includes("/history/")) {
      polls++;
      return Promise.resolve(jsonRes(polls > pending ? { p1: imageOut } : {}));
    }
    if (url.includes("/view")) return Promise.resolve(blobRes(blob));
    return Promise.resolve(jsonRes({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("generateComfyImage", () => {
  it("queues, polls until done, and returns the image bytes", async () => {
    const { fetchMock, calls } = stubRun(2);
    const blob = await generateComfyImage({ settings, prompt: "a tower" });
    expect(blob.type).toBe("image/png");
    expect(calls[0]).toBe("http://127.0.0.1:8188/prompt");
    expect(calls.filter((c) => c.includes("/history/p1")).length).toBe(3);
    expect(calls.at(-1)).toContain("/view?filename=Loom_001_.png");

    // The POST carries the substituted graph and a client id, and deliberately
    // no Content-Type — that keeps it a CORS simple request with no preflight.
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.headers).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.client_id).toMatch(/^loom-/);
    expect(body.prompt["6"].inputs.text).toBe("a tower");
  });

  it("reshapes a portrait request to 2:3 in the latent node", async () => {
    const { fetchMock } = stubRun();
    await generateComfyImage({ settings, prompt: "a knight", aspectRatio: "2:3" });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.prompt["5"].inputs.width).toBeLessThan(body.prompt["5"].inputs.height);
  });

  it("refuses a workflow that would never see the prompt, without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      generateComfyImage({ settings: { ...settings, comfyWorkflow: "{}" } as Settings, prompt: "x" }),
    ).rejects.toThrow(/%prompt%/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a 400 as a rejected workflow rather than a bare status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonRes(
          { error: { message: "Prompt outputs failed validation" }, node_errors: {} },
          false,
          400,
        ),
      ),
    );
    await expect(generateComfyImage({ settings, prompt: "x" })).rejects.toThrow(
      /rejected the workflow — Prompt outputs failed validation/,
    );
  });

  it("turns a 403 into the --enable-cors-header hint, and does not retry it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}, false, 403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateComfyImage({ settings, prompt: "x" })).rejects.toThrow(
      /--enable-cors-header/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the failing node when the job errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("/prompt")
            ? jsonRes({ prompt_id: "p1" })
            : jsonRes({
                p1: {
                  status: {
                    status_str: "error",
                    messages: [
                      [
                        "execution_error",
                        {
                          node_id: "4",
                          node_type: "CheckpointLoaderSimple",
                          exception_type: "ValueError",
                          exception_message: "not in list",
                        },
                      ],
                    ],
                  },
                },
              }),
        ),
      ),
    );
    await expect(generateComfyImage({ settings, prompt: "x" })).rejects.toThrow(
      /CheckpointLoaderSimple \[4\]/,
    );
  });

  it("says where to look when the host is unreachable, after retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const p = generateComfyImage({ settings, prompt: "x" });
    const assertion = expect(p).rejects.toThrow(/Could not reach ComfyUI/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up rather than polling forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(url.includes("/prompt") ? jsonRes({ prompt_id: "p1" }) : jsonRes({})),
      ),
    );
    const p = generateComfyImage({ settings, prompt: "x" });
    const assertion = expect(p).rejects.toThrow(/did not finish/);
    await vi.advanceTimersByTimeAsync(COMFY_TIMEOUT_MS + 1000);
    await assertion;
  });

  it("aborts mid-poll", async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(url.includes("/prompt") ? jsonRes({ prompt_id: "p1" }) : jsonRes({})),
      ),
    );
    const p = generateComfyImage({ settings, prompt: "x", signal: ctrl.signal });
    const assertion = expect(p).rejects.toThrow(/Abort/i);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("throws ImageError, so the store's failure badge reads the reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({}, false, 500)));
    vi.useFakeTimers();
    const p = generateComfyImage({ settings, prompt: "x" });
    const assertion = expect(p).rejects.toBeInstanceOf(ImageError);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

/* -------------------------------- discovery ------------------------------- */

describe("pingComfy", () => {
  it("reports the version and the first device", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonRes({
          system: { comfyui_version: "0.3.40" },
          devices: [{ name: "cuda:0 NVIDIA RTX" }],
        }),
      ),
    );
    expect(await pingComfy("http://host:8188")).toEqual({
      version: "0.3.40",
      device: "cuda:0 NVIDIA RTX",
    });
  });

  it("explains a 403 the same way generation does", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({}, false, 403)));
    await expect(pingComfy("http://host:8188")).rejects.toThrow(/--enable-cors-header/);
  });
});

describe("fetchComfyOptions", () => {
  it("reads combo options out of the node schemas and merges the model loaders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("KSampler")) {
          return Promise.resolve(
            jsonRes({
              KSampler: {
                input: {
                  required: {
                    sampler_name: [["euler", "dpmpp_2m"]],
                    scheduler: [["normal", "karras"]],
                  },
                },
              },
            }),
          );
        }
        if (url.includes("CheckpointLoaderSimple")) {
          return Promise.resolve(
            jsonRes({
              CheckpointLoaderSimple: { input: { required: { ckpt_name: [["sd15.safetensors"]] } } },
            }),
          );
        }
        if (url.includes("UNETLoader")) {
          return Promise.resolve(
            jsonRes({ UNETLoader: { input: { required: { unet_name: [["flux.gguf"]] } } } }),
          );
        }
        // A build with no VAELoader — normal, and must not throw.
        return Promise.resolve(jsonRes({}, false, 404));
      }),
    );

    expect(await fetchComfyOptions("http://host:8188")).toEqual({
      models: ["sd15.safetensors", "flux.gguf"],
      samplers: ["euler", "dpmpp_2m"],
      schedulers: ["normal", "karras"],
      vaes: [],
    });
  });

  it("answers with empty lists rather than throwing when the host is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchComfyOptions("http://host:8188")).toEqual({
      models: [],
      samplers: [],
      schedulers: [],
      vaes: [],
    });
  });
});
