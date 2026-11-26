// The normalization shader as a consumer sees it: imported by package name,
// applied to a model built with the consumer's own three.js. Rendering needs
// a GPU, so these check what the shader is given, not what it draws.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { normalizeModel, palette, paletteColor, type Rgb } from '@objectle/shared/shader';

function sourceModel() {
  const baked = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const map = new THREE.DataTexture(new Uint8Array([200, 120, 40, 255]), 1, 1);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0x336699,
      map,
      lightMap: baked,
      aoMap: baked,
      emissive: 0x222222,
      vertexColors: true,
    }),
  );
  const lens = new THREE.Mesh(new THREE.SphereGeometry(), [
    new THREE.MeshBasicMaterial({ color: 0x050505 }),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  ]);
  const model = new THREE.Group();
  model.add(body, new THREE.Group().add(lens));
  return { model, body, lens, map };
}

function materialsOf(root: THREE.Object3D) {
  const materials: THREE.Material[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) materials.push(...[node.material].flat());
  });
  return materials;
}

test('a second consumer draws its own three.js model through the shader by package name', () => {
  const { model } = sourceModel();

  normalizeModel(model);

  const materials = materialsOf(model);
  expect(materials).toHaveLength(3);
  for (const material of materials) {
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe('objectle-normalization');
  }
});

test('keeps the base colour and colour map of each source material', () => {
  const { model, body, lens, map } = sourceModel();

  normalizeModel(model);

  const bodyMaterial = body.material as unknown as THREE.ShaderMaterial;
  expect(bodyMaterial.uniforms.baseColor.value.getHex()).toBe(0x336699);
  expect(bodyMaterial.uniforms.map.value).toBe(map);
  const [darkLens] = lens.material as unknown as THREE.ShaderMaterial[];
  expect(darkLens.uniforms.baseColor.value.getHex()).toBe(0x050505);
  expect(darkLens.uniforms.map.value).toBeNull();
});

test('normalizing an already normalized model changes nothing', () => {
  const { model, body } = sourceModel();
  normalizeModel(model);
  const once = body.material;

  normalizeModel(model);

  expect(body.material).toBe(once);
});

test('discards lighting baked into the source and ignores scene lights', () => {
  const { model, body } = sourceModel();

  normalizeModel(model);

  const material = body.material as unknown as THREE.ShaderMaterial;
  expect(material.lights).toBe(false);
  expect(material.vertexColors).toBe(false);
  for (const baked of ['lightMap', 'aoMap', 'emissive', 'emissiveMap']) {
    expect(material.uniforms).not.toHaveProperty(baked);
  }
});

/** The palette lookup table the shader samples, as a consumer's model receives it. */
function paletteLut() {
  const { model, body } = sourceModel();
  normalizeModel(model);
  const lut = (body.material as unknown as THREE.ShaderMaterial).uniforms.palette.value as THREE.Data3DTexture;
  return lut.image as { width: number; height: number; depth: number; data: Uint8Array };
}

/**
 * What the fragment shader's palette lookup returns for an sRGB colour: its
 * hue, saturation and brightness, as the GLSL computes them, pick the nearest
 * texel. This mirrors the GLSL by hand; it measures the table, not the GPU.
 */
function lookUp(lut: ReturnType<typeof paletteLut>, [r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
  }
  const s = max > 0 ? chroma / max : 0;
  const cell = (x: number, n: number) => Math.min(n - 1, Math.floor(x * n));
  const { width, height, depth, data } = lut;
  const o = 4 * (cell(hue / 6, width) + cell(s, height) * width + cell(max, depth) * width * height);
  return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
}

test('the shader quantizes with the shared palette depth and black floor', () => {
  const lut = paletteLut();
  // The grey column: no saturation, every brightness.
  const greys = Array.from({ length: lut.depth }, (_, i) => lookUp(lut, [i / lut.depth, i / lut.depth, i / lut.depth]));
  const floor = Math.round(palette.blackFloor * 255) / 255;
  expect(greys[0]).toEqual([floor, floor, floor]);
  expect(new Set(greys.map((g) => g.join())).size).toBe(palette.depth);
});

test('the lookup table reproduces paletteColor within a stated bound', () => {
  // Bound: hue and saturation are exact. Brightness is exact except within
  // half a brightness cell of a level boundary, where it may land one level
  // off. On top of that the table stores 8-bit sRGB.
  const lut = paletteLut();
  const storage = 0.5 / 255 + 1e-9;
  const levelStep = (1 - palette.blackFloor) / (palette.depth - 1);
  const boundaries = Array.from({ length: palette.depth - 1 }, (_, k) => palette.blackFloor + levelStep * (k + 0.5));
  const nearBoundary = (v: number) => boundaries.some((b) => Math.abs(v - b) <= 0.5 / lut.depth + 1e-9);

  // A coarse grid over the whole cube plus a fine one near black, where hue
  // and saturation are most sensitive.
  const values = [
    ...Array.from({ length: 41 }, (_, i) => i / 40),
    ...Array.from({ length: 20 }, (_, i) => (i + 1) * 0.0025),
  ];
  let maxDeviation = 0;
  let maxDeviationAwayFromBoundaries = 0;
  for (const r of values) {
    for (const g of values) {
      for (const b of values) {
        const colour: Rgb = [r, g, b];
        const expected = paletteColor(colour);
        const actual = lookUp(lut, colour);
        const deviation = Math.max(...actual.map((x, i) => Math.abs(x - expected[i])));
        maxDeviation = Math.max(maxDeviation, deviation);
        if (!nearBoundary(Math.max(r, g, b))) {
          maxDeviationAwayFromBoundaries = Math.max(maxDeviationAwayFromBoundaries, deviation);
        }
      }
    }
  }

  expect(maxDeviationAwayFromBoundaries).toBeLessThanOrEqual(storage);
  expect(maxDeviation).toBeLessThanOrEqual(levelStep + storage);
});
