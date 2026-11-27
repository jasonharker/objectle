// A test model written as binary glTF: a box (a tea caddy) 10 × 16 × 10 cm,
// centred on the origin, whose +Z face is a separate label material (glTF
// material 1) and every other face its body (material 0). Like a sourced
// model, it carries names, extras and a generator, none of which a stage-6
// export may keep.

export const caddy = { width: 0.1, height: 0.16, depth: 0.1 };

type Face = { normal: [number, number, number]; corners: [number, number, number][] };

function faces(): Face[] {
  const [x, y, z] = [caddy.width / 2, caddy.height / 2, caddy.depth / 2];
  return [
    // +Z, the label: corners from top-left, counter-clockwise seen from outside.
    { normal: [0, 0, 1], corners: [[-x, y, z], [-x, -y, z], [x, -y, z], [x, y, z]] },
    { normal: [0, 0, -1], corners: [[x, y, -z], [x, -y, -z], [-x, -y, -z], [-x, y, -z]] },
    { normal: [1, 0, 0], corners: [[x, y, z], [x, -y, z], [x, -y, -z], [x, y, -z]] },
    { normal: [-1, 0, 0], corners: [[-x, y, -z], [-x, -y, -z], [-x, -y, z], [-x, y, z]] },
    { normal: [0, 1, 0], corners: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { normal: [0, -1, 0], corners: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
  ];
}

/**
 * The label's texture coordinates of a point on the +Z face at height `y`:
 * glTF's, with v running from 0 at the top edge to 1 at the bottom.
 */
export const labelV = (y: number) => (caddy.height / 2 - y) / caddy.height;

/** The model's bytes; `colour` makes otherwise identical models differ. */
export function caddyModel(colour: [number, number, number] = [0.55, 0.25, 0.15]): Buffer {
  // Primitive i uses material i: the body's five faces, then the label.
  const primitives = [faces().slice(1), faces().slice(0, 1)];
  const chunks: Buffer[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const add = (data: Float32Array | Uint16Array, accessor: object, target: number) => {
    const bytes = Buffer.from(data.buffer);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    accessors.push({ bufferView: bufferViews.length - 1, ...accessor });
    chunks.push(padded);
    offset += padded.length;
    return accessors.length - 1;
  };
  const meshPrimitives = primitives.map((group, material) => {
    const positions = group.flatMap(({ corners }) => corners.flat());
    const normals = group.flatMap(({ normal }) => [normal, normal, normal, normal].flat());
    const uvs = group.flatMap(() => [0, 0, 0, 1, 1, 1, 1, 0]);
    const indices = group.flatMap((_, face) => [0, 1, 2, 0, 2, 3].map((corner) => face * 4 + corner));
    const min = [0, 1, 2].map((axis) => Math.min(...positions.filter((_, i) => i % 3 === axis)));
    const max = [0, 1, 2].map((axis) => Math.max(...positions.filter((_, i) => i % 3 === axis)));
    const count = positions.length / 3;
    return {
      attributes: {
        POSITION: add(new Float32Array(positions), { componentType: 5126, count, type: 'VEC3', min, max }, 34962),
        NORMAL: add(new Float32Array(normals), { componentType: 5126, count, type: 'VEC3' }, 34962),
        TEXCOORD_0: add(new Float32Array(uvs), { componentType: 5126, count, type: 'VEC2' }, 34962),
      },
      indices: add(new Uint16Array(indices), { componentType: 5123, count: indices.length, type: 'SCALAR' }, 34963),
      material,
    };
  });
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'a sourcing tool', copyright: 'its author' },
    scene: 0,
    scenes: [{ name: 'tea caddy scene', nodes: [0] }],
    nodes: [{ name: 'tea caddy', mesh: 0, extras: { sku: 'caddy-1' } }],
    meshes: [{ name: 'tea caddy mesh', primitives: meshPrimitives }],
    materials: [
      { name: 'caddy tin', pbrMetallicRoughness: { baseColorFactor: [...colour, 1], metallicFactor: 0 } },
      { name: 'caddy label', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.92, 0.85, 1], metallicFactor: 0 } },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const chunkHeader = (length: number, type: number) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(length, 0);
    bytes.writeUInt32LE(type, 4);
    return bytes;
  };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(bin.length, 0x004e4942), bin]);
}
