// The stage-authoring tool's content seam: what it reads from a content
// directory and what saving an authored Answer Pool object writes there.
// Tests check only the files written and the problems returned.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { stageFingerprints } from '@objectle/shared/render-fingerprint';
import { readAuthoringContent, saveAuthoredObject, type AuthoredObject } from '../src/content-store.ts';

type Json = any;

/** A 1024×1024 lossless WebP header and a payload: the ADR-0006 image format, as far as the check reads. */
function webp(payload: string): Buffer {
  const image = Buffer.concat([Buffer.from([0x2f, 0xff, 0xc3, 0xff, 0x00]), Buffer.from(payload)]);
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(12 + image.length + (image.length % 2), 4);
  header.write('WEBPVP8L', 8, 'latin1');
  header.writeUInt32LE(image.length, 16);
  return Buffer.concat([header, image, Buffer.alloc(image.length % 2)]);
}

/** A binary glTF with no names. */
function glb(json: Json = { asset: { version: '2.0' } }): Buffer {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

const camera = (z: number) => ({ position: [0, 0.1, z], target: [0, 0.05, 0], fov: 30 });

function authored(noun: string, changes: Partial<AuthoredObject> = {}): AuthoredObject {
  return {
    noun,
    difficultyRating: 'medium',
    stageCameras: [0.05, 0.6, 0.12, 0.6, 0.6].map(camera) as AuthoredObject['stageCameras'],
    textMarks: [{ material: 1, uv: [0.1, 0.2, 0.6, 0.4] }],
    ...changes,
  };
}

const assets = (noun: string) => ({
  images: [1, 2, 3, 4, 5].map((stage) => webp(`${noun} stage ${stage}`)),
  model: glb(),
});

async function contentDir(answerPool: Json[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-authoring-'));
  const vocabulary = ['teapot', 'pinecone', 'wooden spoon'].map((name) => ({
    name,
    model: `models/${name.replaceAll(' ', '-')}.glb`,
    category: 'Cooking & Dining',
    size: 0.24,
    naturalOrMade: 'made',
    primaryMaterial: 'ceramic',
    credit: { author: 'A', source: 'test', license: 'CC0-1.0' },
  }));
  await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify(vocabulary));
  await writeFile(join(dir, 'answer-pool.json'), JSON.stringify(answerPool));
  await writeModels(dir, vocabulary);
  return dir;
}

/** A model file for each noun, whose bytes the render fingerprints cover. */
async function writeModels(dir: string, vocabulary: { name: string; model: string }[]) {
  await mkdir(join(dir, 'models'));
  for (const { name, model } of vocabulary) await writeFile(join(dir, model), glb({ asset: { version: '2.0' }, extras: name }));
}

const readJson = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));

describe('saving an authored Answer Pool object', () => {
  test('records its Stage Cameras, Difficulty Rating and text marks, with one asset per Reveal Stage', async () => {
    const dir = await contentDir();
    expect(await saveAuthoredObject(dir, authored('wooden spoon'), assets('wooden spoon'))).toEqual([]);

    const [entry] = await readJson(dir, 'answer-pool.json');
    expect(entry.noun).toBe('wooden spoon');
    expect(entry.difficultyRating).toBe('medium');
    expect(entry.textMarks).toEqual([{ material: 1, uv: [0.1, 0.2, 0.6, 0.4] }]);
    expect(entry.revealStages).toHaveLength(6);
    entry.revealStages.slice(0, 5).forEach((stage: Json, index: number) => {
      expect(stage.stageCamera).toEqual(authored('wooden spoon').stageCameras[index]);
      expect(stage.assets).toHaveLength(1);
      expect(stage.assets[0]).toMatch(/\.webp$/);
    });
    // Stage 6 is viewed from the stage-5 Stage Camera, which its model carries.
    expect(entry.revealStages[5].stageCamera).toBeUndefined();
    expect(entry.revealStages[5].assets[0]).toMatch(/\.glb$/);

    for (const [index, stage] of entry.revealStages.entries()) {
      const expected = index < 5 ? assets('wooden spoon').images[index] : assets('wooden spoon').model;
      expect(await readFile(join(dir, stage.assets[0]))).toEqual(expected);
    }
    // Each stage records what it was rendered from, which the curation build recomputes.
    const model = await readFile(join(dir, 'models/wooden-spoon.glb'));
    expect(entry.revealStages.map((stage: Json) => stage.fingerprint)).toEqual(
      await stageFingerprints(model, authored('wooden spoon').stageCameras),
    );
  });

  test('refuses an object whose model cannot be read, since its render fingerprints cover the model', async () => {
    const dir = await contentDir();
    await rm(join(dir, 'models/teapot.glb'));
    const problems = await saveAuthoredObject(dir, authored('teapot'), assets('teapot'));
    expect(problems).toEqual(['the model of teapot, models/teapot.glb, cannot be read']);
    expect(await readJson(dir, 'answer-pool.json')).toEqual([]);
  });

  test('replaces the object’s earlier entry and keeps every other entry as it was', async () => {
    const other = { noun: 'pinecone', revealStages: [], difficultyRating: 'hard', note: 'kept' };
    const dir = await contentDir([{ noun: 'teapot', difficultyRating: 'easy' }, other]);
    await saveAuthoredObject(dir, authored('teapot', { difficultyRating: 'hard' }), assets('teapot'));

    const answerPool = await readJson(dir, 'answer-pool.json');
    expect(answerPool.map((entry: Json) => entry.noun)).toEqual(['teapot', 'pinecone']);
    expect(answerPool[0].difficultyRating).toBe('hard');
    expect(answerPool[1]).toEqual(other);
  });

  test('adds a Guess Vocabulary noun to the Answer Pool, creating answer-pool.json if there is none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'objectle-authoring-'));
    await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify([{ name: 'teapot', model: 'models/teapot.glb' }]));
    await writeModels(dir, [{ name: 'teapot', model: 'models/teapot.glb' }]);
    expect(await saveAuthoredObject(dir, authored('teapot'), assets('teapot'))).toEqual([]);
    expect((await readJson(dir, 'answer-pool.json')).map((entry: Json) => entry.noun)).toEqual(['teapot']);
  });

  test.each([
    ['a noun outside the Guess Vocabulary', authored('kettle'), 'kettle is not in the Guess Vocabulary'],
    ['no Difficulty Rating', authored('teapot', { difficultyRating: undefined as never }), 'no Difficulty Rating'],
    ['an unknown Difficulty Rating', authored('teapot', { difficultyRating: 'tricky' as never }), 'not easy, medium or hard'],
    [
      'four Stage Cameras',
      authored('teapot', { stageCameras: authored('teapot').stageCameras.slice(0, 4) as never }),
      'needs a Stage Camera for each of Reveal Stages 1-5',
    ],
    [
      'a Stage Camera looking at its own position',
      authored('teapot', {
        stageCameras: [...authored('teapot').stageCameras.slice(0, 4), { position: [0, 0, 1], target: [0, 0, 1], fov: 30 }] as never,
      }),
      'Reveal Stage 5 has a Stage Camera that is not a position, a different target and a field of view',
    ],
    [
      'a text mark that is not a material and a UV rectangle',
      authored('teapot', { textMarks: [{ material: -1, uv: [0, 0, 1] }] as never }),
      'text mark 1 is not a material and a UV rectangle',
    ],
  ])('refuses %s and writes nothing', async (_, object, problem) => {
    const dir = await contentDir();
    const problems = await saveAuthoredObject(dir, object, assets(object.noun));
    expect(problems.join('\n')).toContain(problem);
    expect(await readJson(dir, 'answer-pool.json')).toEqual([]);
  });

  test('refuses a noun whose asset paths belong to another Answer Pool object, leaving that object’s assets as they were', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'objectle-authoring-'));
    const vocabulary = ['pine cone', 'pine-cone'].map((name) => ({ name, model: `models/${name}.glb` }));
    await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify(vocabulary));
    await writeModels(dir, vocabulary);
    expect(await saveAuthoredObject(dir, authored('pine cone'), assets('pine cone'))).toEqual([]);
    const before = await readJson(dir, 'answer-pool.json');

    const problems = await saveAuthoredObject(dir, authored('pine-cone'), assets('pine-cone'));
    expect(problems.join('\n')).toContain('"pine cone"');
    expect(await readJson(dir, 'answer-pool.json')).toEqual(before);
    for (const [index, stage] of before[0].revealStages.entries()) {
      const expected = index < 5 ? assets('pine cone').images[index] : assets('pine cone').model;
      expect(await readFile(join(dir, stage.assets[0]))).toEqual(expected);
    }
  });

  test('refuses an asset the curation build would refuse, naming its Reveal Stage', async () => {
    const dir = await contentDir();
    const lossy = Buffer.from(webp('x').toString('latin1').replace('VP8L', 'VP8 '), 'latin1');
    const named = glb({ asset: { version: '2.0', generator: 'a tool' }, nodes: [{ name: 'teapot' }] });
    const problems = await saveAuthoredObject(dir, authored('teapot'), {
      images: [...assets('teapot').images.slice(0, 2), lossy, ...assets('teapot').images.slice(3)],
      model: named,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Reveal Stage 3 .*not a lossless WebP/),
        expect.stringMatching(/Reveal Stage 6 .*names its generator/),
        expect.stringMatching(/Reveal Stage 6 .*carries a name/),
      ]),
    );
    expect(await readJson(dir, 'answer-pool.json')).toEqual([]);
  });
});

describe('reading a content directory for authoring', () => {
  test('lists every Guess Vocabulary noun with its model, and what is already authored for the Answer Pool', async () => {
    const dir = await contentDir();
    await saveAuthoredObject(dir, authored('teapot'), assets('teapot'));
    const content = await readAuthoringContent(dir);
    expect(content.guessVocabulary).toEqual([
      { name: 'teapot', model: 'models/teapot.glb' },
      { name: 'pinecone', model: 'models/pinecone.glb' },
      { name: 'wooden spoon', model: 'models/wooden-spoon.glb' },
    ]);
    expect(content.authored).toEqual([authored('teapot')]);
  });

  test('skips an Answer Pool entry that has no Stage Cameras yet', async () => {
    const dir = await contentDir([{ noun: 'pinecone', difficultyRating: 'easy', revealStages: [] }]);
    expect((await readAuthoringContent(dir)).authored).toEqual([]);
  });
});
