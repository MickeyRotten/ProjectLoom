/**
 * Inline markdown — a tiny, pure formatter for narrator prose.
 *
 * The narrator model emits light markdown (`**bold**`, `*italic*`, `` `code` ``);
 * this splits a run of text into styled spans the UI renders. Deliberately
 * inline-only (no block/heading/list handling) — beats are prose, and the
 * dialogue segmenter in `spotlight.ts` already owns paragraph/line structure.
 *
 * Kept pure + tested (the drift guard): parsing never throws, and any
 * unbalanced marker (common mid-stream, e.g. a half-typed `**`) degrades to
 * literal text rather than swallowing the rest of the beat.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** The style flags a span can carry, without the text payload. */
type Style = Omit<Span, "text">;

type StyleKey = keyof Style;

/** Delimiters, longest-first so `**` wins over `*` at the same position. */
const DELIMS: { marker: string; key: StyleKey }[] = [
  { marker: "`", key: "code" },
  { marker: "**", key: "bold" },
  { marker: "__", key: "bold" },
  { marker: "*", key: "italic" },
  { marker: "_", key: "italic" },
];

function emit(spans: Span[], text: string, base: Style): void {
  if (text) spans.push({ text, ...base });
}

/**
 * Parse `text` into styled spans, inheriting `base` styling. Recurses on the
 * inner content of the first delimiter pair found (code spans stay literal —
 * no nested formatting inside backticks).
 */
function parse(text: string, base: Style): Span[] {
  for (let i = 0; i < text.length; i++) {
    for (const { marker, key } of DELIMS) {
      if (!text.startsWith(marker, i)) continue;
      const from = i + marker.length;
      const close = text.indexOf(marker, from);
      if (close === -1) continue; // unbalanced — not a real delimiter here

      const inner = text.slice(from, close);
      if (!inner) continue; // empty `**` / `` — treat markers as literal

      const spans: Span[] = [];
      emit(spans, text.slice(0, i), base);
      if (key === "code") {
        spans.push({ text: inner, ...base, code: true });
      } else {
        spans.push(...parse(inner, { ...base, [key]: true }));
      }
      spans.push(...parse(text.slice(close + marker.length), base));
      return spans;
    }
  }
  const out: Span[] = [];
  emit(out, text, base);
  return out;
}

/** Public entry: styled spans for a run of inline-markdown text. */
export function parseInline(text: string): Span[] {
  return parse(text, {});
}
