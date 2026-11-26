// Seam 2: the curation build, driven as a command-line tool on content
// directories. Tests check only its exit status, the bundle it writes and the
// problems it lists.
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { ContentBundle } from '@objectle/shared';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// Curation input is JSON written by hand, so tests edit it as loose objects.
type Json = any;

interface ContentInput {
  guessVocabulary: Json[];
  answerPool: Json[];
  schedule: Json[];
}

const slug = (name: string) => name.replaceAll(' ', '-');

function noun(name: string, attributes: Json = {}): Json {
  return {
    name,
    model: `models/${slug(name)}.glb`,
    category: 'Cooking & Dining',
    size: 0.24,
    naturalOrMade: 'made',
    primaryMaterial: 'ceramic',
    credit: { author: `Author of ${name}`, source: 'test', license: 'CC0-1.0' },
    ...attributes,
  };
}

function answerPoolEntry(name: string, difficultyRating = 'easy'): Json {
  return {
    noun: name,
    revealStages: [1, 2, 3, 4, 5, 6].map((stage) => ({
      assets: [`assets/${slug(name)}-stage-${stage}.${stage < 6 ? 'webp' : 'glb'}`],
    })),
    difficultyRating,
  };
}

function validContent(): ContentInput {
  return {
    guessVocabulary: [
      noun('teapot'),
      noun('pinecone', { category: 'Nature', size: 0.09, naturalOrMade: 'natural', primaryMaterial: 'organic' }),
      noun('wooden spoon', { size: 0.3, primaryMaterial: 'wood' }),
    ],
    answerPool: [answerPoolEntry('teapot'), answerPoolEntry('pinecone', 'medium')],
    schedule: [
      { puzzleNumber: 1, noun: 'teapot', pinned: false },
      { puzzleNumber: 2, noun: 'pinecone', pinned: true },
    ],
  };
}

/**
 * File bytes in the format a path's extension names, distinct per path: a
 * 1024×1024 lossless WebP header, or a binary glTF with no names, each
 * followed by the path as payload (ADR-0006). Nothing decodes the payload.
 */
function fileBytes(path: string): Buffer {
  const payload = Buffer.from(`bytes of ${path}`);
  if (path.endsWith('.webp')) {
    const image = Buffer.concat([Buffer.from([0x2f, 0xff, 0xc3, 0xff, 0x00]), payload]);
    const header = Buffer.alloc(20);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(12 + image.length + (image.length % 2), 4);
    header.write('WEBPVP8L', 8, 'latin1');
    header.writeUInt32LE(image.length, 16);
    return Buffer.concat([header, image, Buffer.alloc(image.length % 2)]);
  }
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28));
  const bin = Buffer.concat([payload, Buffer.alloc((4 - (payload.length % 4)) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binHeader, bin]);
}

/**
 * Write a content directory: the curation input files plus a distinct model
 * and stage asset file for every path the valid content names. `edit` changes
 * the JSON after the files are written, so it can point at missing files.
 */
async function contentDir(edit: (content: ContentInput) => void = () => {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-curation-'));
  const content = validContent();
  const files = [
    ...content.guessVocabulary.map(({ model }) => model),
    ...content.answerPool.flatMap(({ revealStages }) => revealStages.flatMap(({ assets }: Json) => assets)),
  ];
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), fileBytes(file));
  }
  edit(content);
  await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify(content.guessVocabulary));
  await writeFile(join(dir, 'answer-pool.json'), JSON.stringify(content.answerPool));
  await writeFile(join(dir, 'schedule.json'), JSON.stringify(content.schedule));
  return dir;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  bundleDir: string;
}

/** Run the curation build's command-line tool on a content directory. */
async function curate(dir: string, bundleDir?: string): Promise<Run> {
  bundleDir ??= join(await mkdtemp(join(tmpdir(), 'objectle-bundle-')), 'bundle');
  const out = bundleDir;
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, dir, out], (error, stdout, stderr) => {
      resolve({ status: error ? Number(error.code) : 0, stdout, stderr, bundleDir: out });
    });
  });
}

async function readBundle(bundleDir: string): Promise<ContentBundle> {
  return JSON.parse(await readFile(join(bundleDir, 'bundle.json'), 'utf8'));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Build edited content, expecting failure; returns the listed problems. */
async function problems(edit: (content: ContentInput) => void): Promise<string> {
  const run = await curate(await contentDir(edit));
  expect(run.status, run.stderr).toBe(1);
  expect(await exists(join(run.bundleDir, 'bundle.json'))).toBe(false);
  return run.stderr;
}

const find = (content: ContentInput, name: string) => content.guessVocabulary.find((entry) => entry.name === name);
const findAnswer = (content: ContentInput, name: string) => content.answerPool.find((entry) => entry.noun === name);

describe.concurrent('A valid content directory', () => {
  test('builds a content bundle', async () => {
    const run = await curate(await contentDir());
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe('');

    const bundle = await readBundle(run.bundleDir);
    expect(bundle.guessVocabulary).toEqual([
      { ...noun('teapot'), inAnswerPool: true },
      {
        ...noun('pinecone', { category: 'Nature', size: 0.09, naturalOrMade: 'natural', primaryMaterial: 'organic' }),
        inAnswerPool: true,
      },
      { ...noun('wooden spoon', { size: 0.3, primaryMaterial: 'wood' }), inAnswerPool: false },
    ]);
    expect(bundle.answerPool).toEqual([answerPoolEntry('teapot'), answerPoolEntry('pinecone', 'medium')]);
    expect(bundle.schedule).toEqual(validContent().schedule);
  });

  test('copies every model and stage asset into the bundle', async () => {
    const dir = await contentDir();
    const run = await curate(dir);
    const bundle = await readBundle(run.bundleDir);
    const files = [
      ...bundle.guessVocabulary.map(({ model }) => model),
      ...bundle.answerPool.flatMap(({ revealStages }) => revealStages.flatMap(({ assets }) => assets)),
    ];
    expect(files).toHaveLength(3 + 12);
    for (const file of files) {
      expect(await readFile(join(run.bundleDir, file))).toEqual(await readFile(join(dir, file)));
    }
  });

  test('accepts every one of the fourteen Categories and eleven Primary Materials', async () => {
    const categories = [
      'Food & Drink',
      'Cooking & Dining',
      'Music',
      'Sport & Play',
      'Tools & Repair',
      'Gardening',
      'Office & Study',
      'Media & Computing',
      'Home & Furniture',
      'Clothing & Accessories',
      'Health & Personal Care',
      'Transport',
      'Travel & Outdoors',
      'Nature',
    ];
    const materials = [
      'organic',
      'wood',
      'metal',
      'plastic',
      'fabric',
      'leather',
      'glass',
      'ceramic',
      'rubber',
      'paper',
      'stone',
    ];
    const run = await curate(
      await contentDir((content) => {
        for (const [i, category] of categories.entries()) {
          content.guessVocabulary.push({
            ...noun(`noun ${i}`, { category, primaryMaterial: materials[i % materials.length] }),
            model: 'models/teapot.glb',
          });
        }
      }),
    );
    expect(run.status, run.stderr).toBe(0);
  });

  test('a noun absent from the Answer Pool is not in it, even if its entry says so', async () => {
    const run = await curate(
      await contentDir((content) => {
        find(content, 'wooden spoon').inAnswerPool = true;
      }),
    );
    expect(run.status, run.stderr).toBe(0);
    const bundle = await readBundle(run.bundleDir);
    expect(bundle.guessVocabulary.find(({ name }) => name === 'wooden spoon')!.inAnswerPool).toBe(false);
  });

  test('refuses to write into a bundle directory that is not empty', async () => {
    const bundleDir = await mkdtemp(join(tmpdir(), 'objectle-bundle-'));
    await writeFile(join(bundleDir, 'stale.glb'), 'left from an earlier build');
    const run = await curate(await contentDir(), bundleDir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(bundleDir);
    expect(await exists(join(bundleDir, 'bundle.json'))).toBe(false);
  });

  test('without a content and a bundle directory, prints its usage', async () => {
    const run = await new Promise<{ status: number; stderr: string }>((resolve) => {
      execFile(process.execPath, [cli], (error, _stdout, stderr) => resolve({ status: Number(error?.code ?? 0), stderr }));
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/usage/i);
  });
});

describe.concurrent('A Guess Vocabulary noun', () => {
  test('without a model fails, naming the noun', async () => {
    expect(await problems((content) => delete find(content, 'wooden spoon').model)).toMatch(
      /"wooden spoon" has no model/,
    );
  });

  test('whose model file is missing fails, naming the noun and the file', async () => {
    expect(await problems((content) => (find(content, 'wooden spoon').model = 'models/missing.glb'))).toMatch(
      /"wooden spoon" .*models\/missing\.glb/,
    );
  });

  test.each([
    ['category', 'Category'],
    ['size', 'Size'],
    ['naturalOrMade', 'natural vs. made'],
    ['primaryMaterial', 'Primary Material'],
  ])('without the %s Attribute fails, naming the noun and the Attribute', async (field, attribute) => {
    expect(await problems((content) => delete find(content, 'teapot')[field])).toContain(
      `"teapot" has no ${attribute}`,
    );
  });

  test('with a Category outside the fourteen fails, naming the noun and the Category', async () => {
    expect(await problems((content) => (find(content, 'teapot').category = 'kitchenware'))).toMatch(
      /"teapot" has Category "kitchenware", which is not a Category/,
    );
  });

  test('with a Primary Material outside the eleven fails, naming the noun and the material', async () => {
    expect(await problems((content) => (find(content, 'teapot').primaryMaterial = 'bronze'))).toMatch(
      /"teapot" has Primary Material "bronze", which is not a Primary Material/,
    );
  });

  test.each([0, -0.1, '0.24'])('with Size %j fails, naming the noun', async (size) => {
    expect(await problems((content) => (find(content, 'teapot').size = size))).toMatch(/"teapot" has Size/);
  });

  test('with natural vs. made other than natural or made fails, naming the noun', async () => {
    expect(await problems((content) => (find(content, 'teapot').naturalOrMade = 'grown'))).toMatch(
      /"teapot" has natural vs\. made "grown"/,
    );
  });

  test('without a Credit fails, naming the noun', async () => {
    expect(await problems((content) => delete find(content, 'pinecone').credit)).toContain('"pinecone" has no Credit');
  });

  test.each(['author', 'source', 'license'])('with a Credit missing its %s fails, naming the noun', async (field) => {
    expect(await problems((content) => delete find(content, 'pinecone').credit[field])).toContain(
      `"pinecone" has a Credit with no ${field}`,
    );
  });

  test('without a name fails', async () => {
    expect(await problems((content) => delete find(content, 'wooden spoon').name)).toMatch(
      /Guess Vocabulary entry 3 has no name/,
    );
  });

  test('listed twice fails, naming the noun', async () => {
    expect(await problems((content) => content.guessVocabulary.push(noun('teapot')))).toMatch(
      /"teapot" is in the Guess Vocabulary more than once/,
    );
  });

  test('whose model lies outside the content directory fails, naming the noun', async () => {
    expect(await problems((content) => (find(content, 'teapot').model = '../teapot.glb'))).toMatch(
      /"teapot" .*\.\.\/teapot\.glb.*outside the content directory/,
    );
  });
});

describe.concurrent('An Answer Pool object', () => {
  test('without six Reveal Stages fails, naming the noun and the count', async () => {
    expect(await problems((content) => findAnswer(content, 'teapot').revealStages.pop())).toMatch(
      /Answer Pool object "teapot" has 5 Reveal Stages, not 6/,
    );
  });

  test('without Reveal Stages fails, naming the noun', async () => {
    expect(await problems((content) => delete findAnswer(content, 'pinecone').revealStages)).toMatch(
      /Answer Pool object "pinecone" has no Reveal Stages/,
    );
  });

  test('with a Reveal Stage without assets fails, naming the noun and the stage', async () => {
    expect(await problems((content) => (findAnswer(content, 'teapot').revealStages[3].assets = []))).toMatch(
      /Answer Pool object "teapot" Reveal Stage 4 has no assets/,
    );
  });

  test('with a missing stage asset file fails, naming the noun, the stage and the file', async () => {
    expect(
      await problems((content) => (findAnswer(content, 'teapot').revealStages[1].assets = ['assets/missing.webp'])),
    ).toMatch(/Answer Pool object "teapot" Reveal Stage 2 .*assets\/missing\.webp/);
  });

  test('without a Difficulty Rating fails, naming the noun', async () => {
    expect(await problems((content) => delete findAnswer(content, 'pinecone').difficultyRating)).toMatch(
      /Answer Pool object "pinecone" has no Difficulty Rating/,
    );
  });

  test('with a Difficulty Rating other than easy, medium or hard fails, naming the noun', async () => {
    expect(await problems((content) => (findAnswer(content, 'pinecone').difficultyRating = 'tricky'))).toMatch(
      /Answer Pool object "pinecone" has Difficulty Rating "tricky"/,
    );
  });

  test('whose noun is not in the Guess Vocabulary fails, naming the noun', async () => {
    expect(
      await problems((content) => {
        content.guessVocabulary = content.guessVocabulary.filter(({ name }) => name !== 'pinecone');
      }),
    ).toMatch(/Answer Pool object "pinecone" is not in the Guess Vocabulary/);
  });

  test('listed twice fails, naming the noun', async () => {
    expect(await problems((content) => content.answerPool.push(answerPoolEntry('teapot')))).toMatch(
      /Answer Pool object "teapot" is in the Answer Pool more than once/,
    );
  });

  test('with a stage asset whose bytes match another stage asset file fails, naming both files', async () => {
    // The API names a stage asset by the hash of its bytes, so two files with
    // the same bytes would be one asset.
    const dir = await contentDir((content) => {
      findAnswer(content, 'pinecone').revealStages[0].assets = ['assets/copy.webp'];
    });
    await writeFile(join(dir, 'assets/copy.webp'), await readFile(join(dir, 'assets/teapot-stage-1.webp')));
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/"pinecone" Reveal Stage 1 .*assets\/copy\.webp.*assets\/teapot-stage-1\.webp/);
  });
});

describe.concurrent('A Reveal Stage asset (ADR-0006)', () => {
  test('that is not a lossless 1024×1024 WebP at Reveal Stages 1–5 fails, naming the noun, stage, file and problem', async () => {
    const dir = await contentDir();
    await writeFile(join(dir, 'assets/teapot-stage-2.webp'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/"teapot" Reveal Stage 2 .*assets\/teapot-stage-2\.webp, which is not a WebP image/);
  });

  test('that carries a name at Reveal Stage 6 fails, naming the noun, stage, file and problem', async () => {
    const dir = await contentDir();
    const named = fileBytes('assets/pinecone-stage-6.glb');
    named.write('{"name":"cone","asset":{}}'.padEnd(28), 20); // same length as the JSON chunk it replaces
    await writeFile(join(dir, 'assets/pinecone-stage-6.glb'), named);
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/"pinecone" Reveal Stage 6 .*assets\/pinecone-stage-6\.glb, which carries a name/);
  });

  test('with the bytes of a Guess Vocabulary model fails, since a Ghost would match it', async () => {
    const dir = await contentDir();
    await writeFile(join(dir, 'assets/teapot-stage-6.glb'), await readFile(join(dir, 'models/wooden-spoon.glb')));
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/"teapot" Reveal Stage 6 .*teapot-stage-6\.glb, whose bytes .* models\/wooden-spoon\.glb/);
  });
});

describe.concurrent('The Schedule', () => {
  test('naming a noun outside the Answer Pool fails, naming the Puzzle Number and the noun', async () => {
    expect(
      await problems((content) => content.schedule.push({ puzzleNumber: 3, noun: 'wooden spoon', pinned: false })),
    ).toMatch(/Puzzle Number 3 is scheduled to "wooden spoon", which is not in the Answer Pool/);
  });

  test('assigning a Puzzle Number twice fails, naming the Puzzle Number', async () => {
    expect(
      await problems((content) => content.schedule.push({ puzzleNumber: 2, noun: 'teapot', pinned: false })),
    ).toMatch(/Puzzle Number 2 is scheduled more than once/);
  });

  test.each([0, 1.5, '3'])('with Puzzle Number %j fails', async (puzzleNumber) => {
    expect(
      await problems((content) => content.schedule.push({ puzzleNumber, noun: 'teapot', pinned: false })),
    ).toMatch(/Schedule entry 3 has Puzzle Number/);
  });
});

describe.concurrent('Content input files', () => {
  const inputFiles = ['guess-vocabulary.json', 'answer-pool.json', 'schedule.json'];

  test.each(inputFiles)('a missing %s fails, naming the file', async (file) => {
    const dir = await contentDir();
    await rm(join(dir, file));
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(file);
  });

  test.each(inputFiles)('a %s that is not a JSON array fails, naming the file', async (file) => {
    const dir = await contentDir();
    await writeFile(join(dir, file), '{ "not": "an array" }');
    const run = await curate(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(file);
  });
});

test('lists every problem in one run, not just the first', async () => {
  const stderr = await problems((content) => {
    delete find(content, 'wooden spoon').model;
    find(content, 'teapot').category = 'kitchenware';
    find(content, 'teapot').primaryMaterial = 'bronze';
    delete find(content, 'pinecone').credit;
    findAnswer(content, 'teapot').revealStages.pop();
    delete findAnswer(content, 'pinecone').difficultyRating;
  });
  for (const problem of [
    /"wooden spoon" has no model/,
    /"teapot" has Category "kitchenware"/,
    /"teapot" has Primary Material "bronze"/,
    /"pinecone" has no Credit/,
    /"teapot" has 5 Reveal Stages/,
    /"pinecone" has no Difficulty Rating/,
  ]) {
    expect(stderr).toMatch(problem);
  }
});
