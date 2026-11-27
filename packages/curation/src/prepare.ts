// Asset preparation: turns a sourced model (a CC0/CC-BY scan, a stylized
// low-poly set, image-to-3D output) into a Guess Vocabulary model the curation
// build takes. Terms follow GLOSSARY.md.
//
// The noun's Guess Vocabulary entry is written first, with its Size and
// Credit: preparation refuses a noun without a Credit, scales the model so its
// longest dimension is the Size (ADR-0005), and writes it as binary glTF (the
// format the client's model loader reads) to the entry's model path. The
// source's lighting is dropped from the file as the shader drops it at draw
// time (ADR-0002). Brand logos are the curator's to paint out; the report
// lists what to check.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Logger, NodeIO, getBounds, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  center,
  clearNodeTransform,
  dedup,
  flatten,
  join as joinPrimitives,
  metalRough,
  normals,
  prune,
  simplify,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { creditProblems, inputFiles, readInput, staysInside } from './build.ts';

/** Most triangles a prepared model keeps; denser sources are simplified down to it. */
export const triangleCap = 20_000;
/** A prepared model over this many bytes is flagged: Ghosts download on phones. */
const byteBudget = 1_500_000;
/** A texture wider or taller than this is flagged. */
const textureBudget = 1024;
/** Extensions the client's loader reads and that carry no lighting; every other one is dropped. */
const keptExtensions = new Set(['KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_texture_webp']);

await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

export interface Preparation {
  /** Why the model was not prepared; when there are any, nothing is written. */
  problems: string[];
  /** What preparation did and what the curator should check, one line each. */
  report: string[];
}

const round = (value: number) => Number(value.toPrecision(3));
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function triangles(doc: Document): number {
  return doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .filter((primitive) => primitive.getMode() === 4) // TRIANGLES
    .reduce((sum, primitive) => sum + (primitive.getIndices() ?? primitive.getAttribute('POSITION')!).getCount() / 3, 0);
}

function dimensions(doc: Document): number[] {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  return max.map((value, axis) => value - min[axis]);
}

/** Strip everything the shader would discard as lighting; returns what was dropped. */
function dropLighting(doc: Document): { dropped: string[]; vertexColoured: number } {
  const root = doc.getRoot();
  const dropped = new Set<string>();
  const lights = root.listNodes().filter((node) => node.getExtension('KHR_lights_punctual')).length;
  if (lights > 0) dropped.add(plural(lights, 'light'));
  for (const extension of root.listExtensionsUsed()) {
    if (!keptExtensions.has(extension.extensionName)) extension.dispose();
  }
  for (const material of root.listMaterials()) {
    if (material.getEmissiveTexture() || material.getEmissiveFactor().some((value) => value > 0)) dropped.add('emissive glow');
    if (material.getOcclusionTexture()) dropped.add('occlusion map');
    material
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0])
      .setOcclusionTexture(null)
      .setMetallicRoughnessTexture(null);
  }
  let vertexColoured = 0;
  const primitives: Primitive[] = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  for (const primitive of primitives) {
    const colours = primitive.listSemantics().filter((semantic) => semantic.startsWith('COLOR_'));
    if (colours.length > 0) vertexColoured++;
    for (const semantic of colours) primitive.setAttribute(semantic, null);
  }
  if (vertexColoured > 0) dropped.add('vertex colours');
  // Animation, skinning and cameras have no place in a still model.
  for (const property of [...root.listAnimations(), ...root.listSkins(), ...root.listCameras()]) property.dispose();
  return { dropped: [...dropped], vertexColoured };
}

/**
 * Prepare `source` (a .gltf or .glb file) as the model of Guess Vocabulary
 * noun `noun` in `contentDir`, writing it to the model path its entry names.
 */
export async function prepareModel(contentDir: string, noun: string, source: string): Promise<Preparation> {
  const problems: string[] = [];
  const report: string[] = [];
  const vocabulary = await readInput(contentDir, inputFiles.guessVocabulary, problems);
  if (vocabulary === undefined) return { problems, report };
  const entry = vocabulary.find(
    (candidate): candidate is Record<string, unknown> =>
      typeof candidate === 'object' && candidate !== null && (candidate as { name?: unknown }).name === noun,
  );
  if (entry === undefined) return { problems: [`"${noun}" is not in the Guess Vocabulary`], report };

  const label = `Guess Vocabulary noun "${noun}"`;
  problems.push(...creditProblems(entry.credit, label));
  const { size, model } = entry;
  if (size === undefined || size === null) problems.push(`${label} has no Size`);
  else if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    problems.push(`${label} has Size ${JSON.stringify(size)}, which is not a positive number of metres`);
  }
  if (typeof model !== 'string' || !model.endsWith('.glb')) {
    problems.push(`${label} has model ${model}, which is not a .glb file`);
  } else if (!staysInside(model)) {
    problems.push(`${label} has model ${model}, which is outside the content directory`);
  }

  let doc: Document;
  try {
    doc = await io.read(source);
  } catch (error) {
    problems.push(`source model ${source} could not be read as glTF: ${(error as Error).message}`);
    return { problems, report };
  }
  if (problems.length > 0) return { problems, report };
  // Its warnings go to stderr; its progress lines would drown out the report.
  doc.setLogger(new Logger(Logger.Verbosity.WARN));

  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (scene === undefined) return { problems: [`source model ${source} has no geometry`], report };
  root.setDefaultScene(scene);
  for (const other of root.listScenes()) if (other !== scene) other.dispose();

  // Specular-glossiness sources keep their colour map in the extension, so convert before dropping extensions.
  if (root.listExtensionsUsed().some(({ extensionName }) => extensionName === 'KHR_materials_pbrSpecularGlossiness')) {
    await doc.transform(metalRough());
  }
  const { dropped, vertexColoured } = dropLighting(doc);

  // Parent the whole model under one node, so one scale and offset apply to all of it.
  const whole = doc.createNode('model');
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    whole.addChild(child);
  }
  scene.addChild(whole);
  const longest = Math.max(...dimensions(doc));
  if (!(Number.isFinite(longest) && longest > 0)) return { problems: [`source model ${source} has no geometry`], report };
  const factor = (size as number) / longest;
  whole.setScale([factor, factor, factor]);

  // Stand it on the origin, then bake every transform into the vertices so the file is at true metres.
  await doc.transform(center({ pivot: 'below' }), flatten());
  for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);
  await doc.transform(dedup(), joinPrimitives(), weld(), prune());

  const sourceTriangles = triangles(doc);
  if (sourceTriangles > triangleCap) {
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: triangleCap / sourceTriangles, error: 0.01 }),
      prune(),
    );
  }
  // Last, as these are flat normals for sources that had none, and they unweld what they touch.
  const unshaded = root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .filter((primitive) => !primitive.getAttribute('NORMAL')).length;
  await doc.transform(normals({ overwrite: false }));
  const preparedTriangles = triangles(doc);

  const bytes = await io.writeBinary(doc);
  const out = join(contentDir, model as string);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);

  report.push(
    `prepared "${noun}" into ${model}: ${plural(preparedTriangles, 'triangle')}, ${Math.ceil(bytes.length / 1024)} KB`,
    `scaled ×${round(factor)} so its longest dimension (${round(longest)} in the source) is its Size; ` +
      `it is now ${dimensions(doc).map(round).join(' × ')} m, so check that against a real ${noun}`,
  );
  if (dropped.length > 0) report.push(`dropped the source's lighting: ${dropped.join(', ')}`);
  if (sourceTriangles > triangleCap) {
    report.push(`simplified from ${plural(sourceTriangles, 'triangle')}`);
    if (preparedTriangles > triangleCap) {
      report.push(`check: still over the ${triangleCap} triangle cap; simplify the source by hand`);
    }
  }
  if (vertexColoured > 0) {
    report.push(
      `check: vertex colours were dropped from ${plural(vertexColoured, 'primitive')}; ` +
        'if they were its colour rather than baked lighting, the model now draws in its base colour only',
    );
  }
  if (unshaded > 0) {
    report.push(`check: the source had no normals for ${plural(unshaded, 'primitive')}, so they are flat-shaded`);
  }
  const mapped = root
    .listMaterials()
    .filter((material) => material.getBaseColorTexture())
    .map((material) => `"${material.getName()}"`);
  if (mapped.length > 0) {
    report.push(`check: paint out any brand logos in the colour maps of ${mapped.join(', ')}`);
  }
  const large = root.listTextures().filter((texture) => Math.max(...(texture.getSize() ?? [0])) > textureBudget);
  for (const texture of large) {
    report.push(`check: texture "${texture.getName()}" is ${texture.getSize()!.join('×')}, over ${textureBudget}`);
  }
  if (bytes.length > byteBudget) report.push(`check: over the ${byteBudget / 1_000_000} MB model budget`);
  return { problems: [], report };
}
