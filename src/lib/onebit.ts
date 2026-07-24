import type { DitherMode } from "../types";

/**
 * True 1-bit quantization. Image models cannot output genuine 1-bit art — they
 * paint a *picture of* ink art with soft edges and stray greys — so the client
 * downscales and quantizes every generated image itself. The prompt therefore
 * asks for clean bold ink (never "pixel art": a model-drawn fake pixel grid
 * would moiré against the real downscale grid applied here).
 *
 * This module is the pure, tested core: RGBA bytes in, strict black/white out.
 * The canvas decode/downscale/encode wrapper (`toOneBitBlob`) lives in
 * images.ts, since jsdom has no real canvas.
 */

/**
 * Classic 4x4 Bayer ordered-dither matrix — the same pattern as ImageMagick's
 * `-ordered-dither o4x4`.
 */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Rec. 709 luma from 8-bit RGB. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Quantize RGBA pixel data to strict 1-bit in place: every channel becomes
 * pure 0 or 255, alpha becomes fully opaque.
 *
 * - `bayer4` — ordered dither; mid-tones become the classic retro checker
 *   texture.
 * - `threshold` — flat 50% cut; mid-tones collapse to solid black or white.
 */
export function quantizeToOneBit(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: DitherMode,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = luminance(data[i], data[i + 1], data[i + 2]);
      const cut =
        mode === "bayer4" ? ((BAYER_4X4[y % 4][x % 4] + 0.5) / 16) * 255 : 128;
      const v = lum >= cut ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
}
