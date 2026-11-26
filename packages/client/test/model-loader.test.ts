// The loader seam: every model the client loads comes back already drawn
// through the normalization shader (ADR-0002), whatever its source carried.
import { Color, LinearSRGBColorSpace, Mesh, ShaderMaterial, type Material } from 'three';
import { expect, test } from 'vitest';
import { loadModel } from '../src/model-loader.ts';

/**
 * A one-triangle binary glTF whose source material bakes in lighting: vertex
 * colours, an emissive glow, and an unlit extension.
 */
function bakedModel(): ArrayBuffer {
  const floats = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0.5, 0.5, 0.5, 0.2, 0.2, 0.2]);
  const gltf = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] },
        emissiveFactor: [1, 0.5, 0],
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    buffers: [{ byteLength: floats.byteLength }],
  };
  return glb(JSON.stringify(gltf), new Uint8Array(floats.buffer));
}

/** Pack glTF JSON and its binary buffer into a GLB file. */
function glb(json: string, bin: Uint8Array): ArrayBuffer {
  const pad = (bytes: Uint8Array, fill: number) => {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
    padded.set(bytes);
    return padded;
  };
  const chunks = [
    [0x4e4f534a, pad(new TextEncoder().encode(json), 0x20)], // JSON
    [0x004e4942, pad(bin, 0)], // BIN
  ] as const;
  const length = 12 + chunks.reduce((sum, [, data]) => sum + 8 + data.length, 0);
  const file = new DataView(new ArrayBuffer(length));
  file.setUint32(0, 0x46546c67, true); // glTF
  file.setUint32(4, 2, true);
  file.setUint32(8, length, true);
  let offset = 12;
  for (const [type, data] of chunks) {
    file.setUint32(offset, data.length, true);
    file.setUint32(offset + 4, type, true);
    new Uint8Array(file.buffer, offset + 8).set(data);
    offset += 8 + data.length;
  }
  return file.buffer;
}

const serve = (body: ArrayBuffer) => (async () => new Response(body)) as unknown as typeof fetch;

function materialsOf(model: Awaited<ReturnType<typeof loadModel>>) {
  const materials: Material[] = [];
  model.traverse((node) => {
    if (node instanceof Mesh) materials.push(...[node.material].flat());
  });
  return materials;
}

test('every loaded model is drawn through the normalization shader', async () => {
  const model = await loadModel(serve(bakedModel()), '/model');

  const materials = materialsOf(model);
  expect(materials).toHaveLength(1);
  const [material] = materials as ShaderMaterial[];
  expect(material).toBeInstanceOf(ShaderMaterial);
  expect(material.name).toBe('objectle-normalization');
  expect(material.uniforms.baseColor.value.toArray()).toEqual(
    new Color().setRGB(0.2, 0.4, 0.6, LinearSRGBColorSpace).toArray(),
  );
});

test('a loaded model’s baked lighting and vertex colours are discarded', async () => {
  const model = await loadModel(serve(bakedModel()), '/model');

  const [material] = materialsOf(model) as ShaderMaterial[];
  expect(material.vertexColors).toBe(false);
  expect(material.lights).toBe(false);
  for (const baked of ['emissive', 'emissiveMap', 'lightMap', 'aoMap']) {
    expect(material.uniforms).not.toHaveProperty(baked);
  }
});
