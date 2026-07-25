import { describe, it, expect } from "vitest";
import { matchWorldNotes, formatWorldNotesBlock } from "./worldNotes";
import type { Note } from "../types";

function note(patch: Partial<Note> & { id: string; title: string }): Note {
  return { keywords: [], content: "", ...patch };
}

const well = note({
  id: "n1",
  title: "The Old Well",
  keywords: ["well", "water"],
  content: "The last working well in the frontier.",
});
const cult = note({
  id: "n2",
  title: "Ash Cult",
  keywords: ["cult", "ashers"],
  content: "Zealots who worship the burning.",
});

describe("matchWorldNotes", () => {
  it("matches on an explicit keyword", () => {
    expect(matchWorldNotes([well, cult], "I lower the bucket into the well")).toEqual([well]);
  });

  it("matches on the title as an implicit keyword", () => {
    expect(matchWorldNotes([well, cult], "we near the ash cult camp")).toEqual([cult]);
  });

  it("is case-insensitive", () => {
    expect(matchWorldNotes([cult], "The ASHERS chant")).toEqual([cult]);
  });

  it("respects word boundaries (no partial hits)", () => {
    expect(matchWorldNotes([well], "I bid a fond farewell")).toEqual([]);
  });

  it("returns matches in note order, de-duplicated across keywords", () => {
    // Text hits both "well" and "water" of the same note → note appears once.
    expect(matchWorldNotes([well, cult], "the well holds water and the cult waits")).toEqual([
      well,
      cult,
    ]);
  });

  it("ignores notes with no usable keywords", () => {
    const blank = note({ id: "n3", title: "   ", keywords: ["   "] });
    expect(matchWorldNotes([blank], "anything at all")).toEqual([]);
  });

  it("returns nothing for empty scan text", () => {
    expect(matchWorldNotes([well], "   ")).toEqual([]);
  });

  it("always includes a permanent note, even with no keyword hit", () => {
    const law = note({ id: "n4", title: "The Ash Law", permanent: true, content: "no fires" });
    expect(matchWorldNotes([law, cult], "I climb the ridge")).toEqual([law]);
  });

  it("includes a permanent note with no keywords at all, and for empty scan text", () => {
    const law = note({ id: "n4", title: "   ", permanent: true, content: "no fires" });
    expect(matchWorldNotes([law], "   ")).toEqual([law]);
  });

  it("lists permanent and matched notes together in note order, without duplicates", () => {
    const law = note({ id: "n4", title: "The Ash Law", permanent: true, keywords: ["law"] });
    // "law" would also match by keyword — the permanent branch must not double it.
    expect(matchWorldNotes([well, law, cult], "the law of the well")).toEqual([well, law]);
  });
});

describe("formatWorldNotesBlock", () => {
  it("renders a WORLD NOTES block with title + content", () => {
    const block = formatWorldNotesBlock([well]);
    expect(block).toContain("WORLD NOTES");
    expect(block).toContain("The Old Well: The last working well");
  });

  it("is empty when no notes matched", () => {
    expect(formatWorldNotesBlock([])).toBe("");
  });
});
