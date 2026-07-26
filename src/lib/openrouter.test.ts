import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchModels } from "./openrouter";

/**
 * Catalog parsing only — the streaming paths need a live-ish SSE body and are
 * covered by `retry.test.ts`. What matters here is that "free" is read off the
 * pricing the catalog actually returns, because the picker's Free-only
 * checkbox is only as honest as this.
 */
function stubCatalog(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ data }),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchModels", () => {
  it("reads id, name and output modalities", async () => {
    stubCatalog([
      {
        id: "b/two",
        name: "Two",
        architecture: { output_modalities: ["image", "text"] },
        pricing: { prompt: "0.001", completion: "0.002" },
      },
      { id: "a/one", pricing: { prompt: "0", completion: "0" } },
    ]);
    const models = await fetchModels();
    // Sorted by id, and a nameless entry falls back to its id.
    expect(models.map((m) => m.id)).toEqual(["a/one", "b/two"]);
    expect(models[0].name).toBe("a/one");
    expect(models[1].outputModalities).toEqual(["image", "text"]);
  });

  it("is free only when neither prompt nor completion bills", async () => {
    stubCatalog([
      { id: "free/zero", pricing: { prompt: "0", completion: "0" } },
      { id: "paid/out", pricing: { prompt: "0", completion: "0.0000006" } },
      { id: "paid/in", pricing: { prompt: "0.0000006", completion: "0" } },
    ]);
    const free = Object.fromEntries((await fetchModels()).map((m) => [m.id, m.free]));
    expect(free).toEqual({ "free/zero": true, "paid/in": false, "paid/out": false });
  });

  it("treats unreadable or missing pricing as priced, never as free", async () => {
    stubCatalog([
      { id: "no/pricing" },
      { id: "odd/pricing", pricing: { prompt: "ask us", completion: "0" } },
      { id: "half/pricing", pricing: { completion: "0" } },
    ]);
    const models = await fetchModels();
    expect(models.every((m) => !m.free)).toBe(true);
  });

  it("skips junk entries instead of failing the whole catalog", async () => {
    stubCatalog([null, "nope", { name: "no id" }, { id: "ok/one", pricing: { prompt: "0", completion: "0" } }]);
    const models = await fetchModels();
    expect(models.map((m) => m.id)).toEqual(["ok/one"]);
  });
});
