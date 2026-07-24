import { describe, expect, it } from "vitest";
import { quantizeToOneBit } from "./onebit";

/** Build a w×h RGBA buffer filled with one grey level (opaque). */
function flat(w: number, h: number, level: number, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = level;
    data[i + 1] = level;
    data[i + 2] = level;
    data[i + 3] = alpha;
  }
  return data;
}

function channelValues(data: Uint8ClampedArray): Set<number> {
  const values = new Set<number>();
  for (let i = 0; i < data.length; i += 4) values.add(data[i]);
  return values;
}

describe("quantizeToOneBit", () => {
  it("outputs only pure black or pure white, fully opaque (both modes)", () => {
    for (const mode of ["bayer4", "threshold"] as const) {
      const data = flat(8, 8, 100, 42);
      // Give it some variety so both sides of the cut appear.
      data[0] = data[1] = data[2] = 250;
      data[4] = data[5] = data[6] = 5;
      quantizeToOneBit(data, 8, 8, mode);
      for (let i = 0; i < data.length; i += 4) {
        expect([0, 255]).toContain(data[i]);
        expect(data[i + 1]).toBe(data[i]);
        expect(data[i + 2]).toBe(data[i]);
        expect(data[i + 3]).toBe(255);
      }
    }
  });

  it("keeps pure black black and pure white white (both modes)", () => {
    for (const mode of ["bayer4", "threshold"] as const) {
      const black = flat(4, 4, 0);
      quantizeToOneBit(black, 4, 4, mode);
      expect(channelValues(black)).toEqual(new Set([0]));

      const white = flat(4, 4, 255);
      quantizeToOneBit(white, 4, 4, mode);
      expect(channelValues(white)).toEqual(new Set([255]));
    }
  });

  it("dithers flat mid-grey into a mix of black and white", () => {
    const data = flat(4, 4, 128);
    quantizeToOneBit(data, 4, 4, "bayer4");
    expect(channelValues(data)).toEqual(new Set([0, 255]));
  });

  it("thresholds flat mid-grey to a single uniform tone", () => {
    const data = flat(4, 4, 128);
    quantizeToOneBit(data, 4, 4, "threshold");
    expect(channelValues(data).size).toBe(1);
  });

  it("thresholds dark grey to black and light grey to white", () => {
    const dark = flat(4, 4, 40);
    quantizeToOneBit(dark, 4, 4, "threshold");
    expect(channelValues(dark)).toEqual(new Set([0]));

    const light = flat(4, 4, 220);
    quantizeToOneBit(light, 4, 4, "threshold");
    expect(channelValues(light)).toEqual(new Set([255]));
  });
});
