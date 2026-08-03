import { describe, expect, it } from "vitest";
import {
  MAX_FONT_FACES,
  cssUrl,
  fontFaceCss,
  normalizeFamily,
  parseFamily,
  parseFontFaces,
  selectFaces,
  slugFamily,
} from "./webFonts";

/**
 * A trimmed but otherwise verbatim css2 response. The shape matters more than
 * the content: subset names live in comments and nowhere else, and each block
 * carries exactly one woff2 URL plus a unicode-range.
 */
const CSS = `/* cyrillic-ext */
@font-face {
  font-family: 'Silkscreen';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/silkscreen/v4/cyr-ext.woff2) format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C88;
}
/* latin-ext */
@font-face {
  font-family: 'Silkscreen';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/silkscreen/v4/lat-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Silkscreen';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/silkscreen/v4/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2212;
}
`;

describe("normalizeFamily", () => {
  it("collapses whitespace", () => {
    expect(normalizeFamily("  Press   Start  ")).toBe("Press Start");
  });

  it("title-cases an all-lowercase entry — css2 400s on a case mismatch", () => {
    expect(normalizeFamily("silkscreen")).toBe("Silkscreen");
    expect(normalizeFamily("press start 2p")).toBe("Press Start 2p");
  });

  it("leaves anything with capitals exactly as typed", () => {
    // "Press Start 2P" is a real family name; no rule that produced it from the
    // lowercase form would leave names like "VT323" intact.
    expect(normalizeFamily("Press Start 2P")).toBe("Press Start 2P");
    expect(normalizeFamily("VT323")).toBe("VT323");
  });

  it("returns empty for empty", () => {
    expect(normalizeFamily("   ")).toBe("");
  });
});

describe("slugFamily", () => {
  it("makes an attribute- and key-safe id", () => {
    expect(slugFamily("Press Start 2P")).toBe("press-start-2p");
    expect(slugFamily("Noto Sans JP")).toBe("noto-sans-jp");
  });

  it("strips leading and trailing separators", () => {
    expect(slugFamily("  —Weird— ")).toBe("weird");
  });
});

describe("cssUrl", () => {
  it("encodes the family", () => {
    expect(cssUrl("Press Start 2P")).toBe(
      "https://fonts.googleapis.com/css2?family=Press%20Start%202P&display=swap",
    );
  });
});

describe("parseFamily", () => {
  it("reads Google's own spelling off the stylesheet", () => {
    // Preferred over what the player typed, so the stored name and the CSS
    // font-family can never disagree.
    expect(parseFamily(CSS)).toBe("Silkscreen");
  });

  it("returns null when there is nothing to read", () => {
    expect(parseFamily("")).toBeNull();
  });
});

describe("parseFontFaces", () => {
  it("pulls every block with its subset, url and range", () => {
    const faces = parseFontFaces(CSS);
    expect(faces.map((f) => f.subset)).toEqual(["cyrillic-ext", "latin-ext", "latin"]);
    expect(faces[2].url).toBe("https://fonts.gstatic.com/s/silkscreen/v4/lat.woff2");
    expect(faces[2].unicodeRange).toBe("U+0000-00FF, U+0131, U+2212");
  });

  it("handles a quoted url and a block with no range", () => {
    const css = `@font-face { font-family: 'X'; src: url("https://x/y.woff2") format('woff2'); }`;
    expect(parseFontFaces(css)).toEqual([
      { subset: "", unicodeRange: "", url: "https://x/y.woff2" },
    ]);
  });

  it("skips a block with no downloadable src", () => {
    const css = `@font-face { font-family: 'X'; src: local('X'); }`;
    expect(parseFontFaces(css)).toEqual([]);
  });

  it("returns nothing for a response that is not a stylesheet", () => {
    expect(parseFontFaces("<!DOCTYPE html><p>404</p>")).toEqual([]);
  });
});

describe("selectFaces", () => {
  it("keeps latin and latin-ext, matching the bundled faces", () => {
    // Character and location names are player-authored, so accented Latin is
    // ordinary input here — but cyrillic is bytes nobody asked for.
    const kept = selectFaces(parseFontFaces(CSS));
    expect(kept.map((f) => f.subset)).toEqual(["latin-ext", "latin"]);
  });

  it("falls back to the first few blocks when nothing is labelled", () => {
    const faces = Array.from({ length: 9 }, (_, i) => ({
      subset: "",
      unicodeRange: "",
      url: `https://x/${i}.woff2`,
    }));
    expect(selectFaces(faces).length).toBe(MAX_FONT_FACES);
  });

  it("keeps nothing from nothing", () => {
    expect(selectFaces([])).toEqual([]);
  });
});

describe("fontFaceCss", () => {
  const font = {
    family: "Silkscreen",
    id: "silkscreen",
    ranges: ["U+0100-02BA", "U+0000-00FF"],
  };

  it("emits one face per file, each with its stored range", () => {
    // The ranges are persisted for exactly this: two subset files emitted
    // WITHOUT them both claim every character, the later one wins, and a
    // latin-ext file with no basic Latin in it blanks the whole app.
    const css = fontFaceCss(font, ["blob:a", "blob:b"]);
    expect(css.match(/@font-face/g)?.length).toBe(2);
    expect(css).toContain("src: url(blob:a) format(\"woff2\");");
    expect(css).toContain("unicode-range: U+0100-02BA;");
    expect(css).toContain("unicode-range: U+0000-00FF;");
  });

  it("hangs the family off the same data-font hook the bundled faces use", () => {
    const css = fontFaceCss(font, ["blob:a"]);
    expect(css).toContain('[data-font="silkscreen"]');
    expect(css).toContain('--font-mono: "Silkscreen", ui-monospace');
  });

  it("omits the range descriptor when there is none stored", () => {
    const css = fontFaceCss({ family: "X", id: "x", ranges: [] }, ["blob:a"]);
    expect(css).not.toContain("unicode-range");
  });

  it("quotes a family name that would otherwise break the rule", () => {
    const css = fontFaceCss({ family: 'Ev"il', id: "evil", ranges: [] }, ["blob:a"]);
    expect(css).toContain('font-family: "Ev\\"il";');
  });
});
