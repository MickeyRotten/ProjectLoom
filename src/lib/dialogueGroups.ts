import type { Segment } from "./spotlight";

/**
 * Consecutive `segmentDialogue` segments from the same speaker (dialogue or
 * plain narration alike, `speaker: null` included) collapsed into one row, so
 * a chat avatar isn't repeated for every paragraph of an uninterrupted run —
 * mirrors how Discord collapses consecutive messages from the same author.
 * `segmentDialogue`'s own scan already alternates prose/dialogue in the
 * common case (a whole no-dialogue beat is already one `null` segment); this
 * only matters when the same character delivers two attributed lines back to
 * back with nothing between them.
 */
export interface SpeakerGroup {
  speaker: string | null;
  texts: string[];
}

export function groupSegments(segments: Segment[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = [];
  for (const seg of segments) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === seg.speaker) last.texts.push(seg.text);
    else groups.push({ speaker: seg.speaker, texts: [seg.text] });
  }
  return groups;
}
