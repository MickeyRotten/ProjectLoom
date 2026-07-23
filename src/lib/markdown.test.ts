import { describe, it, expect } from "vitest";
import { parseInline } from "./markdown";

describe("parseInline", () => {
  it("returns a single plain span for text with no markers", () => {
    expect(parseInline("just prose")).toEqual([{ text: "just prose" }]);
  });

  it("returns nothing for empty input", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("parses **bold**", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c" },
    ]);
  });

  it("parses __bold__ (underscore form)", () => {
    expect(parseInline("__b__")).toEqual([{ text: "b", bold: true }]);
  });

  it("parses *italic* and _italic_", () => {
    expect(parseInline("*a* _b_")).toEqual([
      { text: "a", italic: true },
      { text: " " },
      { text: "b", italic: true },
    ]);
  });

  it("parses `code` literally (no nested formatting)", () => {
    expect(parseInline("`**x**`")).toEqual([{ text: "**x**", code: true }]);
  });

  it("nests italic inside bold", () => {
    expect(parseInline("**bold *and* more**")).toEqual([
      { text: "bold ", bold: true },
      { text: "and", bold: true, italic: true },
      { text: " more", bold: true },
    ]);
  });

  it("prefers ** over * at the same position", () => {
    const spans = parseInline("**b**");
    expect(spans).toEqual([{ text: "b", bold: true }]);
  });

  it("leaves an unbalanced marker as literal text", () => {
    expect(parseInline("half **open")).toEqual([{ text: "half **open" }]);
  });

  it("leaves a lone marker as literal", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
  });

  it("treats empty markers as literal", () => {
    expect(parseInline("****")).toEqual([{ text: "****" }]);
  });

  it("leaves intra-word underscores literal (snake_case)", () => {
    expect(parseInline("call snake_case now")).toEqual([{ text: "call snake_case now" }]);
    expect(parseInline("__dunder__ init")).toEqual([
      { text: "dunder", bold: true },
      { text: " init" },
    ]);
    expect(parseInline("a_b_c")).toEqual([{ text: "a_b_c" }]);
  });

  it("still parses boundary-delimited _italic_ / __bold__", () => {
    expect(parseInline("a _b_ c")).toEqual([
      { text: "a " },
      { text: "b", italic: true },
      { text: " c" },
    ]);
    expect(parseInline("__b__")).toEqual([{ text: "b", bold: true }]);
  });

  it("handles multiple bold runs", () => {
    expect(parseInline("**a** and **b**")).toEqual([
      { text: "a", bold: true },
      { text: " and " },
      { text: "b", bold: true },
    ]);
  });
});
