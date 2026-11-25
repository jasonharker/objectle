// The normalization shader as a consumer sees it: imported by package name,
// applied to a model built with the consumer's own three.js. Rendering needs
// a GPU, so these check what the shader is given, not what it draws.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { normalizeModel, palette, type Rgb } from '@objectle/shared/shader';

function sourceModel() {
  const baked = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const map = new THREE.DataTexture(new Uint8Array([200, 120, 40, 255]), 1, 1);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x336699, map, lightMap: baked, aoMap: baked, emissive: 0x222222 }),
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

test('discards lighting baked into the source and ignores scene lights', () => {
  const { model, body } = sourceModel();

  normalizeModel(model);

  const material = body.material as unknown as THREE.ShaderMaterial;
  expect(material.lights).toBe(false);
  for (const baked of ['lightMap', 'aoMap', 'emissive', 'emissiveMap']) {
    expect(material.uniforms).not.toHaveProperty(baked);
  }
});

test('the shader quantizes with the shared palette depth and black floor', () => {
  const { model, body } = sourceModel();

  normalizeModel(model);

  const lut = (body.material as unknown as THREE.ShaderMaterial).uniforms.palette.value as THREE.Data3DTexture;
  const { width: n, data } = lut.image as { width: number; data: Uint8Array };
  const at = (i: number): Rgb => {
    const o = 4 * (i + i * n + i * n * n); // the grey diagonal
    return [data[o], data[o + 1], data[o + 2]];
  };
  const greys = Array.from({ length: n }, (_, i) => at(i));
  const floor = Math.round(palette.blackFloor * 255);
  expect(greys[0]).toEqual([floor, floor, floor]);
  expect(new Set(greys.map((g) => g.join())).size).toBe(palette.depth);
});
