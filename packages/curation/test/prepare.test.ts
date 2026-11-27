// Asset preparation, driven as a command-line tool: a sourced model goes in,
// and the Guess Vocabulary model the curation build takes comes out. Tests
// check only its exit status, the model file it writes and what it reports.
// Source models are generated here; nothing is fetched from a model site.
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Document, NodeIO, getBounds, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRLightsPunctual, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { Box3, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
// The client's loader seam, so "loads in the game" means the game's own loader.
import { loadModel } from '../../client/src/model-loader.ts';

const prepareCli = fileURLToPath(new URL('../src/prepare-cli.ts', import.meta.url));
const buildCli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// Curation input is JSON written by hand, so tests edit it as loose objects.
type Json = any;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function teapot(attributes: Json = {}): Json {
  return {
    name: 'teapot',
    model: 'models/teapot.glb',
    category: 'Cooking & Dining',
    size: 0.3,
    naturalOrMade: 'made',
    primaryMaterial: 'ceramic',
    credit: { author: 'A. Modeller', source: 'https://example.org/teapot', license: 'CC-BY-4.0' },
    ...attributes,
  };
}

/** A content directory holding just a Guess Vocabulary, with an empty Answer Pool. */
async function contentDir(guessVocabulary: Json[] = [teapot()]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-prepare-'));
  await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify(guessVocabulary));
  await writeFile(join(dir, 'answer-pool.json'), '[]');
  await writeFile(join(dir, 'pins.json'), '[]');
  return dir;
}

/**
 * A 2×2 PNG of one colour beside white, so each texture slot gets distinct
 * bytes and none is a solid colour that could be folded into a factor.
 */
function png([r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = [0, r, g, b, 255, 255, 255];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The 12 triangles of an axis-aligned box from `min` to `max`, with vertex colours and UVs. */
function addBox(doc: Document, min: number[], max: number[], material: Material) {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, 1, 2].map((axis) => ((i >> axis) & 1 ? max : min)[axis]));
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(corners.flat()))
    .setBuffer(buffer);
  const colour = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(new Float32Array(corners.flatMap(() => [0.3, 0.3, 0.3, 1])))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType('VEC2')
    .setArray(new Float32Array(corners.flatMap(([x, y]) => [x, y])))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])))
    .setBuffer(buffer);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('COLOR_0', colour)
    .setAttribute('TEXCOORD_0', uv)
    .setIndices(indices)
    .setMaterial(material);
  return doc.createMesh().addPrimitive(primitive);
}

/**
 * A sourced teapot as image-to-3D tools and scans often deliver it: authored
 * in centimetres (30 × 10 × 20), off the origin under a parent node, and
 * carrying its source's lighting: vertex colours, an unlit extension, an
 * emissive glow and a scene light. With `textures`, its material also has a
 * colour map, a normal map, and baked occlusion, emissive and
 * metallic-roughness maps.
 */
function sourceTeapot({ textures = false } = {}): Document {
  const doc = new Document();
  doc.createBuffer();
  const material = doc.createMaterial('glaze').setBaseColorFactor([0.8, 0.2, 0.1, 1]).setEmissiveFactor([1, 1, 1]);
  material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  if (textures) {
    const texture = (name: string, colour: [number, number, number]) =>
      doc.createTexture(name).setImage(png(colour)).setMimeType('image/png');
    material
      .setBaseColorTexture(texture('painted label', [200, 30, 30]))
      .setNormalTexture(texture('normal', [128, 128, 255]))
      .setOcclusionTexture(texture('baked occlusion', [90, 90, 90]))
      .setEmissiveTexture(texture('baked glow', [255, 255, 200]))
      .setMetallicRoughnessTexture(texture('metal roughness', [0, 200, 0]));
  }
  const body = doc.createNode('body').setMesh(addBox(doc, [0, 0, 0], [30, 10, 20], material));
  const parent = doc.createNode('offset').setTranslation([100, 50, -20]).addChild(body);
  const light = doc.createExtension(KHRLightsPunctual).createLight('sun').setType('directional');
  const lamp = doc.createNode('lamp').setExtension('KHR_lights_punctual', light);
  doc.createScene().addChild(parent).addChild(lamp);
  return doc;
}

/** A UV sphere of 30,000 triangles, as a raw scan might be. */
function denseSphere(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const [rings, segments] = [120, 125];
  const positions: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const polar = (Math.PI * ring) / rings;
    for (let segment = 0; segment <= segments; segment++) {
      const azimuth = (2 * Math.PI * segment) / segments;
      positions.push(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth));
    }
  }
  const indices: number[] = [];
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('peel'));
  doc.createScene().addChild(doc.createNode('ball').setMesh(doc.createMesh().addPrimitive(primitive)));
  return doc;
}

/** Write a source model outside the content directory, as a downloaded file would be. */
async function writeSource(doc: Document, file = 'source.glb'): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'objectle-source-')), file);
  await writeFile(path, await io.writeBinary(doc));
  return path;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cli: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ status: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

/** Prepare a source model for a noun, with asset preparation's command-line tool. */
const prepare = (dir: string, noun: string, source: string) => run(prepareCli, [dir, noun, source]);

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

const triangles = (doc: Document) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, primitive) => sum + (primitive.getIndices() ?? primitive.getAttribute('POSITION')!).getCount() / 3, 0);

// One at a time: each test prepares a model and some run the curation build, so
// run concurrently on a one-CPU CI agent they share each test's timeout and pass it.
describe('A prepared model', () => {
  test('loads in the game at its Size, standing on the origin', async () => {
    const dir = await contentDir();
    const result = await prepare(dir, 'teapot', await writeSource(sourceTeapot()));
    expect(result.status, result.stderr).toBe(0);

    const bytes = await readFile(join(dir, 'models/teapot.glb'));
    const model = await loadModel(
      (async () => new Response(bytes)) as unknown as typeof fetch,
      '/models/teapot.glb',
    );
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    // Scaled uniformly so the longest dimension is the Size: the source's
    // proportions survive, so a Ghost beside a known object looks right.
    expect(size.x).toBeCloseTo(0.3, 6);
    expect(size.y).toBeCloseTo(0.1, 6);
    expect(size.z).toBeCloseTo(0.2, 6);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    const centre = bounds.getCenter(new Vector3());
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  test('reports the scale it applied, so the curator can check it', async () => {
    const dir = await contentDir();
    const result = await prepare(dir, 'teapot', await writeSource(sourceTeapot()));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('scaled ×0.01');
    expect(result.stdout).toContain('0.3 × 0.1 × 0.2 m');
  });

  test('keeps no baked source lighting', async () => {
    const dir = await contentDir();
    const result = await prepare(dir, 'teapot', await writeSource(sourceTeapot({ textures: true })));
    expect(result.status, result.stderr).toBe(0);

    const doc = await io.read(join(dir, 'models/teapot.glb'));
    const root = doc.getRoot();
    expect(root.listExtensionsUsed().map((extension) => extension.extensionName)).toEqual([]);
    expect(root.listNodes().some((node) => node.getExtension('KHR_lights_punctual'))).toBe(false);
    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives.length).toBeGreaterThan(0);
    for (const primitive of primitives) {
      expect(primitive.listSemantics().filter((semantic) => semantic.startsWith('COLOR_'))).toEqual([]);
    }
    const [material, ...others] = root.listMaterials();
    expect(others).toEqual([]);
    expect(material.getOcclusionTexture()).toBeNull();
    expect(material.getEmissiveTexture()).toBeNull();
    expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(material.getMetallicRoughnessTexture()).toBeNull();
    // The colour and normal maps are the source's surface, not its lighting.
    expect(material.getBaseColorTexture()?.getName()).toBe('painted label');
    expect(material.getNormalTexture()?.getName()).toBe('normal');
    expect(root.listTextures()).toHaveLength(2);
  });

  test('is listed with its colour maps for the curator to check for brand logos', async () => {
    const dir = await contentDir();
    const result = await prepare(dir, 'teapot', await writeSource(sourceTeapot({ textures: true })));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/brand logos.*"glaze"/);
  });

  test('has at most 20,000 triangles', async () => {
    const dir = await contentDir([teapot({ name: 'orange', model: 'models/orange.glb', size: 0.08 })]);
    const source = denseSphere();
    expect(triangles(source)).toBe(30_000);
    const result = await prepare(dir, 'orange', await writeSource(source));
    expect(result.status, result.stderr).toBe(0);

    const doc = await io.read(join(dir, 'models/orange.glb'));
    expect(triangles(doc)).toBeLessThanOrEqual(20_000);
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(Math.max(...max.map((value, axis) => value - min[axis]))).toBeCloseTo(0.08, 3);
  }, 30_000);

  test('is accepted by the curation build', async () => {
    const dir = await contentDir();
    const prepared = await prepare(dir, 'teapot', await writeSource(sourceTeapot({ textures: true })));
    expect(prepared.status, prepared.stderr).toBe(0);

    const bundleDir = join(await mkdtemp(join(tmpdir(), 'objectle-bundle-')), 'bundle');
    const clock = ['--launch-date', '2027-03-01', '--now', '2027-03-01T12:00:00-08:00', '--first-publish'];
    const built = await run(buildCli, [...clock, dir, bundleDir]);
    expect(built.status, built.stderr).toBe(0);
    expect(await readFile(join(bundleDir, 'models/teapot.glb'))).toEqual(
      await readFile(join(dir, 'models/teapot.glb')),
    );
  });

  test('can be prepared from a .gltf with its textures beside it', async () => {
    const dir = await contentDir();
    const sourceDir = await mkdtemp(join(tmpdir(), 'objectle-source-'));
    await io.write(join(sourceDir, 'scene.gltf'), sourceTeapot({ textures: true }));
    const result = await prepare(dir, 'teapot', join(sourceDir, 'scene.gltf'));
    expect(result.status, result.stderr).toBe(0);

    const doc = await io.read(join(dir, 'models/teapot.glb'));
    expect(doc.getRoot().listMaterials()[0].getBaseColorTexture()?.getImage()).toEqual(
      new Uint8Array(png([200, 30, 30])),
    );
  });
});

describe('Asset preparation refuses', () => {
  /** Prepare the teapot into a content directory, expecting failure; returns the listed problems. */
  async function refused(guessVocabulary: Json[], source?: string): Promise<string> {
    const dir = await contentDir(guessVocabulary);
    const result = await prepare(dir, 'teapot', source ?? (await writeSource(sourceTeapot())));
    expect(result.status, result.stderr).toBe(1);
    expect(await exists(join(dir, 'models/teapot.glb'))).toBe(false);
    return result.stderr;
  }

  test('a noun with no Credit', async () => {
    expect(await refused([teapot({ credit: undefined })])).toContain('Guess Vocabulary noun "teapot" has no Credit');
  });

  test.each(['author', 'source', 'license'])('a noun whose Credit has no %s', async (field) => {
    const { credit } = teapot();
    delete credit[field];
    expect(await refused([teapot({ credit })])).toContain(`Guess Vocabulary noun "teapot" has a Credit with no ${field}`);
  });

  test('a noun that is not in the Guess Vocabulary', async () => {
    expect(await refused([teapot({ name: 'kettle', model: 'models/kettle.glb' })])).toContain(
      '"teapot" is not in the Guess Vocabulary',
    );
  });

  test('a noun with no Size to scale to', async () => {
    expect(await refused([teapot({ size: undefined })])).toContain('Guess Vocabulary noun "teapot" has no Size');
  });

  test('a noun whose model is not a .glb file inside the content directory', async () => {
    expect(await refused([teapot({ model: 'models/teapot.obj' })])).toContain(
      'Guess Vocabulary noun "teapot" has model models/teapot.obj, which is not a .glb file',
    );
    expect(await refused([teapot({ model: '../teapot.glb' })])).toContain(
      'Guess Vocabulary noun "teapot" has model ../teapot.glb, which is outside the content directory',
    );
  });

  test('a source that is not a glTF model', async () => {
    const source = join(await mkdtemp(join(tmpdir(), 'objectle-source-')), 'teapot.glb');
    await writeFile(source, 'not a model');
    expect(await refused([teapot()], source)).toContain(`source model ${source} could not be read as glTF`);
  });

  test('a source with no geometry', async () => {
    const doc = new Document();
    doc.createScene().addChild(doc.createNode('empty'));
    expect(await refused([teapot()], await writeSource(doc))).toContain(`has no geometry`);
  });
});

test('prints its usage when not given a content directory, noun and source model', async () => {
  const result = await run(prepareCli, ['content']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('usage:');
});

test('does not overwrite an existing model when refusing', async () => {
  const dir = await contentDir([teapot({ credit: undefined })]);
  await mkdir(join(dir, 'models'));
  await writeFile(join(dir, 'models/teapot.glb'), 'earlier model');
  const result = await prepare(dir, 'teapot', await writeSource(sourceTeapot()));
  expect(result.status).toBe(1);
  expect(await readFile(join(dir, 'models/teapot.glb'), 'utf8')).toBe('earlier model');
});
