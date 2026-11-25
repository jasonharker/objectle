// The stylized normalization shader (ADR-0002). Every model in the game client
// and the stage-authoring tool is drawn through this module, so both see the
// same look whatever the model's source.

/** An sRGB colour, each channel in [0, 1]. */
export type Rgb = [number, number, number];

/**
 * The shared palette definition. `depth` (levels per hue) and `blackFloor`
 * (brightness of the darkest level) are the two tuning settings; change them
 * here and every consumer of the shader follows.
 */
export const palette = {
  /** Brightness levels per hue; ADR-0002 allows 8–16. */
  depth: 12,
  /** Brightness of the darkest level, lifted above pure black. */
  blackFloor: 0.12,
  /** Hues the palette snaps to, evenly spaced round the colour wheel. */
  hues: 24,
  /** Saturation steps from grey to full colour. */
  saturations: 5,
} as const;

const quantize = (x: number, steps: number) => Math.round(x * (steps - 1)) / (steps - 1);

/**
 * The palette colour a base colour is quantized to: hue and saturation snap
 * to the palette's steps, and brightness to the nearest of `depth` levels
 * spaced evenly from the black floor up to full brightness.
 */
export function paletteColor([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
  }
  const { depth, blackFloor, hues, saturations } = palette;
  const h = (Math.round((hue / 6) * hues) % hues) / hues;
  const s = quantize(max === 0 ? 0 : chroma / max, saturations);
  const level = Math.min(depth - 1, Math.max(0, Math.round(((max - blackFloor) / (1 - blackFloor)) * (depth - 1))));
  const v = blackFloor + ((1 - blackFloor) * level) / (depth - 1);
  return hsvToRgb(h, s, v);
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const channel = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channel(5), channel(3), channel(1)];
}
