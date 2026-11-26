// The palette quantization rule of the stylized normalization shader
// (ADR-0002), checked on the CPU: no GPU is needed to know which palette
// colour a base colour becomes. The look itself is judged by eye.
import { expect, test } from 'vitest';
import { palette, paletteColor, type Rgb } from '@objectle/shared/shader';

const key = (c: Rgb) => c.map((x) => x.toFixed(4)).join(',');

/** A base colour of one hue at full saturation and the given brightness. */
function shade(hue: Rgb, brightness: number): Rgb {
  return hue.map((x) => x * brightness) as Rgb;
}

const ramp = (steps: number) => Array.from({ length: steps + 1 }, (_, i) => i / steps);

test.each([
  ['red', [1, 0, 0]],
  ['orange', [1, 0.5, 0]],
  ['blue', [0.2, 0.4, 1]],
  ['grey', [1, 1, 1]],
] as [string, Rgb][])('quantizes %s to exactly the palette depth in levels', (_, hue) => {
  // From just above black: pure black has no hue.
  const levels = new Set(ramp(1000).map((v) => key(paletteColor(shade(hue, Math.max(v, 0.001))))));

  expect(levels.size).toBe(palette.depth);
});

test('keeps the palette depth within the 8–16 levels per hue of ADR-0002', () => {
  expect(palette.depth).toBeGreaterThanOrEqual(8);
  expect(palette.depth).toBeLessThanOrEqual(16);
});

test('lifts pure black to the black floor', () => {
  const floor = paletteColor([0, 0, 0]);

  expect(palette.blackFloor).toBeGreaterThan(0);
  expect(floor).toEqual([palette.blackFloor, palette.blackFloor, palette.blackFloor]);
});

test('never quantizes a near-black colour below the black floor', () => {
  const nearBlack: Rgb[] = [
    [0.02, 0.02, 0.025], // binoculars
    [0.04, 0.06, 0.02], // avocado skin
    [0.01, 0, 0],
  ];
  for (const colour of nearBlack) {
    expect(Math.max(...paletteColor(colour))).toBeCloseTo(palette.blackFloor, 6);
  }
});

test('maps every base colour onto the shared palette', () => {
  const samples = ramp(6).flatMap((r) => ramp(6).flatMap((g) => ramp(6).map((b) => [r, g, b] as Rgb)));
  for (const colour of samples) {
    const quantized = paletteColor(colour);
    expect(key(paletteColor(quantized))).toBe(key(quantized));
  }
});

test('snaps nearby hues to the same palette colour', () => {
  expect(key(paletteColor([0.8, 0.4, 0.1]))).toBe(key(paletteColor([0.8, 0.41, 0.1])));
});
