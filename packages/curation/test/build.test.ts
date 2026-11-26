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
  pins: Json[];
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
    pins: [],
    schedule: [
      { puzzleNumber: 1, noun: 'teapot', pinned: false },
      { puzzleNumber: 2, noun: 'pinecone', pinned: false },
    ],
  };
}

/** An Answer Pool object to add to the valid content: its noun's name and Difficulty Rating. */
type Added = [name: string, difficultyRating: string];

/** `count` Answer Pool objects named `${prefix} 1`, `${prefix} 2`…, all with one Difficulty Rating. */
const objects = (prefix: string, count: number, difficultyRating: string): Added[] =>
  Array.from({ length: count }, (_, i) => [`${prefix} ${i + 1}`, difficultyRating]);

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
 * and stage asset file for every path the valid content names. `added`
 * Answer Pool objects join the valid content, files included. `edit` changes
 * the JSON after the files are written, so it can point at missing files.
 */
async function contentDir(edit: (content: ContentInput) => void = () => {}, added: Added[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-curation-'));
  const content = validContent();
  for (const [name, difficultyRating] of added) {
    content.guessVocabulary.push(noun(name));
    content.answerPool.push(answerPoolEntry(name, difficultyRating));
  }
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
  await writeFile(join(dir, 'pins.json'), JSON.stringify(content.pins));
  await writeFile(join(dir, 'schedule.json'), JSON.stringify(content.schedule));
  return dir;
}

/** The Launch Date every test builds with unless it says otherwise: a Monday. */
const launchDate = '2027-03-01';

/** The Pacific date of a Puzzle Number. */
function dateOf(puzzleNumber: number): string {
  const date = new Date(`${launchDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + puzzleNumber - 1);
  return date.toISOString().slice(0, 10);
}

/** An instant during a Puzzle Number: noon Pacific on its date. */
const during = (puzzleNumber: number) => `${dateOf(puzzleNumber)}T12:00:00-08:00`;

/** The Difficulty Pattern: the rating each Pacific weekday aims for, Sunday first. */
const difficultyPattern = ['medium', 'easy', 'easy', 'medium', 'medium', 'hard', 'hard'];
const aimFor = (puzzleNumber: number) => difficultyPattern[new Date(`${dateOf(puzzleNumber)}T00:00:00Z`).getUTCDay()];

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  bundleDir: string;
}

interface CurateOptions {
  bundleDir?: string;
  /** The injected clock: the instant the build runs at. Puzzle Number 1 by default. */
  now?: string;
  seed?: string;
}

/** Run the curation build's command-line tool on a content directory; the real clock is never read. */
async function curate(dir: string, { bundleDir, now = during(1), seed }: CurateOptions = {}): Promise<Run> {
  bundleDir ??= join(await mkdtemp(join(tmpdir(), 'objectle-bundle-')), 'bundle');
  const out = bundleDir;
  const args = ['--launch-date', launchDate, '--now', now, ...(seed === undefined ? [] : ['--seed', seed])];
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args, dir, out], (error, stdout, stderr) => {
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
async function problems(edit: (content: ContentInput) => void, options: CurateOptions = {}): Promise<string> {
  const run = await curate(await contentDir(edit), options);
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
    const run = await curate(await contentDir(), { bundleDir });
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

/** Copy a bundle's Schedule back into a content directory, as publishing it does. */
async function publish(run: Run, dir: string): Promise<ContentBundle['schedule']> {
  expect(run.status, run.stderr).toBe(0);
  const { schedule } = await readBundle(run.bundleDir);
  await writeFile(join(dir, 'schedule.json'), JSON.stringify(schedule));
  return schedule;
}

const scheduledOn = (schedule: ContentBundle['schedule'], puzzleNumber: number) =>
  schedule.find((entry) => entry.puzzleNumber === puzzleNumber);

/** Enough Answer Pool objects to fill the Planning Horizon on the Difficulty Pattern alone. */
const plenty = [
  ...objects('easy object', 30, 'easy'),
  ...objects('medium object', 45, 'medium'),
  ...objects('hard object', 30, 'hard'),
];
const ratingOf = new Map<string, string>([['teapot', 'easy'], ['pinecone', 'medium'], ...plenty]);

describe.concurrent('The previously published Schedule', () => {
  test('naming a noun outside the Answer Pool on the active Puzzle Number fails, naming both', async () => {
    expect(await problems((content) => (content.schedule[0].noun = 'wooden spoon'))).toMatch(
      /Puzzle Number 1 is active and scheduled to "wooden spoon", which is not in the Answer Pool/,
    );
  });

  test('keeps a past Puzzle Number whose noun has left the Answer Pool', async () => {
    const run = await curate(
      await contentDir((content) => content.schedule.push({ puzzleNumber: 3, noun: 'wooden spoon', pinned: false })),
      { now: during(4) },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 3)).toEqual({
      puzzleNumber: 3,
      noun: 'wooden spoon',
      pinned: false,
    });
  });

  test('refills a future Puzzle Number whose noun has left the Answer Pool', async () => {
    const run = await curate(
      await contentDir(
        (content) => content.schedule.push({ puzzleNumber: 3, noun: 'wooden spoon', pinned: false }),
        [['teacup', 'medium']],
      ),
    );
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 3)).toEqual({
      puzzleNumber: 3,
      noun: 'teacup',
      pinned: false,
    });
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

  test('keeps every assignment a later build has no reason to change, and extends it to the Planning Horizon', async () => {
    const dir = await contentDir(() => {}, plenty);
    const first = await publish(await curate(dir), dir);
    const run = await curate(dir, { now: during(5) });
    expect(run.status, run.stderr).toBe(0);
    const second = (await readBundle(run.bundleDir)).schedule;
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.map(({ puzzleNumber }) => puzzleNumber)).toEqual(Array.from({ length: 95 }, (_, i) => i + 1));
  });

  test('refills only the days that a removed object or a new Pin forces', async () => {
    const dir = await contentDir(() => {}, plenty);
    const first = await publish(await curate(dir), dir);
    const removed = scheduledOn(first, 20)!.noun;
    const pinned = scheduledOn(first, 30)!.noun;
    const answerPool: Json[] = JSON.parse(await readFile(join(dir, 'answer-pool.json'), 'utf8'));
    await writeFile(join(dir, 'answer-pool.json'), JSON.stringify(answerPool.filter((entry) => entry.noun !== removed)));
    await writeFile(join(dir, 'pins.json'), JSON.stringify([{ date: dateOf(60), noun: pinned }]));

    const run = await curate(dir, { now: during(3) });
    expect(run.status, run.stderr).toBe(0);
    const second = (await readBundle(run.bundleDir)).schedule;
    expect(scheduledOn(second, 20)!.noun).not.toBe(removed);
    expect(scheduledOn(second, 30)!.noun).not.toBe(pinned);
    expect(scheduledOn(second, 60)).toEqual({ puzzleNumber: 60, noun: pinned, pinned: true });
    for (const entry of first.filter(({ puzzleNumber }) => ![20, 30, 60].includes(puzzleNumber))) {
      expect(scheduledOn(second, entry.puzzleNumber)).toEqual(entry);
    }
    expect(second.filter(({ noun }) => noun === removed || noun === pinned)).toEqual([
      { puzzleNumber: 60, noun: pinned, pinned: true },
    ]);
  });

  test('refills a future day whose Pin was removed', async () => {
    const run = await curate(await contentDir((content) => (content.schedule[1].pinned = true), [['teacup', 'medium']]));
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 2)!.pinned).toBe(false);
  });
});

describe.concurrent('A Pin', () => {
  test('keeps its date and is recorded as a Pin', async () => {
    const run = await curate(
      await contentDir((content) => content.pins.push({ date: dateOf(40), noun: 'teacup' }), [['teacup', 'hard']]),
    );
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 40)).toEqual({
      puzzleNumber: 40,
      noun: 'teacup',
      pinned: true,
    });
  });

  test('keeps its object through regenerations', async () => {
    const dir = await contentDir((content) => content.pins.push({ date: dateOf(40), noun: 'easy object 1' }), plenty);
    await publish(await curate(dir), dir);
    await publish(await curate(dir, { now: during(10) }), dir);
    const run = await curate(dir, { now: during(39), seed: 'another seed' });
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 40)).toEqual({
      puzzleNumber: 40,
      noun: 'easy object 1',
      pinned: true,
    });
  });

  test('takes its date from an earlier assignment', async () => {
    const dir = await contentDir(() => {}, plenty);
    const first = await publish(await curate(dir), dir);
    const other = scheduledOn(first, 41)!.noun;
    await writeFile(join(dir, 'pins.json'), JSON.stringify([{ date: dateOf(40), noun: other }]));
    const run = await curate(dir);
    expect(run.status, run.stderr).toBe(0);
    const second = (await readBundle(run.bundleDir)).schedule;
    expect(scheduledOn(second, 40)).toEqual({ puzzleNumber: 40, noun: other, pinned: true });
    expect(scheduledOn(second, 41)!.noun).not.toBe(other);
  });

  test('keeps its object out of generated days within the Repeat Gap on either side', async () => {
    const run = await curate(
      await contentDir(
        (content) => content.pins.push({ date: dateOf(30), noun: 'teacup' }),
        [
          ['teacup', 'medium'],
          ['saucer', 'medium'],
          ['milk jug', 'medium'],
        ],
      ),
    );
    expect(run.status, run.stderr).toBe(0);
    const schedule = (await readBundle(run.bundleDir)).schedule;
    expect(schedule.filter(({ noun }) => noun === 'teacup')).toEqual([{ puzzleNumber: 30, noun: 'teacup', pinned: true }]);
    expect(schedule.map(({ noun }) => noun)).toEqual(expect.arrayContaining(['saucer', 'milk jug']));
  });

  test('may fall inside its object’s Repeat Gap', async () => {
    const run = await curate(await contentDir((content) => content.pins.push({ date: dateOf(10), noun: 'teapot' })));
    expect(run.status, run.stderr).toBe(0);
    expect(scheduledOn((await readBundle(run.bundleDir)).schedule, 10)).toEqual({
      puzzleNumber: 10,
      noun: 'teapot',
      pinned: true,
    });
  });

  test('to a noun outside the Answer Pool fails, naming the date and the noun', async () => {
    expect(await problems((content) => content.pins.push({ date: dateOf(10), noun: 'wooden spoon' }))).toContain(
      `Pin on ${dateOf(10)} is to "wooden spoon", which is not in the Answer Pool`,
    );
  });

  test('on a past date fails, naming the date', async () => {
    expect(
      await problems((content) => content.pins.push({ date: dateOf(2), noun: 'pinecone' }), { now: during(3) }),
    ).toContain(`Pin on ${dateOf(2)} is on a past date`);
  });

  test('on the active date fails, naming the date', async () => {
    expect(
      await problems((content) => content.pins.push({ date: dateOf(2), noun: 'pinecone' }), { now: during(2) }),
    ).toContain(`Pin on ${dateOf(2)} is on the active date`);
  });

  test('before the Launch Date fails, naming the date', async () => {
    expect(
      await problems((content) => content.pins.push({ date: '2027-02-28', noun: 'pinecone' }), {
        now: '2027-02-01T12:00:00-08:00',
      }),
    ).toContain('Pin on 2027-02-28 is before the Launch Date');
  });

  test('dates turn over at midnight Pacific, not UTC', async () => {
    const dir = await contentDir((content) => content.pins.push({ date: dateOf(2), noun: 'pinecone' }));
    // 23:59 Pacific on the Launch Date, already the next day in UTC.
    expect((await curate(dir, { now: `${dateOf(2)}T07:59:00Z` })).status).toBe(0);
    expect((await curate(dir, { now: `${dateOf(2)}T08:00:00Z` })).status).toBe(1);
  });

  test('sharing its date with another Pin fails, naming the date', async () => {
    expect(
      await problems((content) =>
        content.pins.push({ date: dateOf(10), noun: 'pinecone' }, { date: dateOf(10), noun: 'teapot' }),
      ),
    ).toContain(`${dateOf(10)} has more than one Pin`);
  });

  test.each(['2027-02-30', '10 March 2027', 20270310])('with date %j fails', async (date) => {
    expect(await problems((content) => content.pins.push({ date, noun: 'pinecone' }))).toContain(
      `Pin 1 has date ${JSON.stringify(date)}, which is not a YYYY-MM-DD date`,
    );
  });

  test('without a noun fails', async () => {
    expect(await problems((content) => content.pins.push({ date: dateOf(10) }))).toContain(
      `Pin on ${dateOf(10)} has no noun`,
    );
  });
});

describe.concurrent('Schedule generation', () => {
  test('assigns every Puzzle Number through the Planning Horizon, 90 past the active one', async () => {
    const run = await curate(await contentDir(() => {}, plenty), { now: during(10) });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).not.toMatch(/shortfall|aims for/i);
    const assigned = (await readBundle(run.bundleDir)).schedule.map(({ puzzleNumber }) => puzzleNumber);
    expect(assigned).toEqual([1, 2, ...Array.from({ length: 91 }, (_, i) => i + 10)]);
  });

  test('before launch, assigns Puzzle Numbers 1 to 91', async () => {
    const run = await curate(await contentDir((content) => (content.schedule = []), plenty), {
      now: '2027-01-15T12:00:00-08:00',
    });
    expect(run.status, run.stderr).toBe(0);
    const assigned = (await readBundle(run.bundleDir)).schedule.map(({ puzzleNumber }) => puzzleNumber);
    expect(assigned).toEqual(Array.from({ length: 91 }, (_, i) => i + 1));
  });

  test('follows the Difficulty Pattern when the Answer Pool allows', async () => {
    const run = await curate(await contentDir(() => {}, plenty));
    const generated = (await readBundle(run.bundleDir)).schedule.filter(({ puzzleNumber }) => puzzleNumber > 2);
    expect(generated).toHaveLength(89);
    for (const { puzzleNumber, noun } of generated) {
      expect(ratingOf.get(noun), `Puzzle Number ${puzzleNumber}`).toBe(aimFor(puzzleNumber));
    }
  });

  test('never repeats an object within the Repeat Gap', async () => {
    // A year on from a full Schedule, only objects last seen 365 or more
    // Puzzle Numbers earlier, or never, are eligible.
    const dir = await contentDir(() => {}, plenty);
    await publish(await curate(dir), dir);
    const run = await curate(dir, { now: during(380) });
    expect(run.status, run.stderr).toBe(0);
    const schedule = (await readBundle(run.bundleDir)).schedule;
    expect(schedule.filter(({ puzzleNumber }) => puzzleNumber >= 380).length).toBeGreaterThan(20);
    const last = new Map<string, number>();
    for (const { puzzleNumber, noun } of schedule) {
      if (last.has(noun)) expect(puzzleNumber - last.get(noun)!, noun).toBeGreaterThanOrEqual(365);
      last.set(noun, puzzleNumber);
    }
  });

  test('makes an object eligible again exactly 365 Puzzle Numbers after its last appearance', async () => {
    const dir = await contentDir((content) => {
      content.answerPool = content.answerPool.filter(({ noun }) => noun !== 'pinecone');
      content.schedule = [{ puzzleNumber: 100, noun: 'teapot', pinned: false }];
    });
    const [early, due] = await Promise.all([curate(dir, { now: during(464) }), curate(dir, { now: during(465) })]);
    expect((await readBundle(early.bundleDir)).schedule).toEqual([{ puzzleNumber: 100, noun: 'teapot', pinned: false }]);
    expect(scheduledOn((await readBundle(due.bundleDir)).schedule, 465)).toEqual({
      puzzleNumber: 465,
      noun: 'teapot',
      pinned: false,
    });
  });

  test('picks the eligible object whose last appearance is oldest, never-appeared first', async () => {
    const run = await curate(
      await contentDir(
        (content) => {
          content.answerPool = content.answerPool.filter(({ noun }) => noun !== 'teapot' && noun !== 'pinecone');
          content.schedule = [
            { puzzleNumber: 100, noun: 'a', pinned: false },
            { puzzleNumber: 130, noun: 'd', pinned: false },
            { puzzleNumber: 138, noun: 'b', pinned: false },
          ];
        },
        [
          ['a', 'medium'],
          ['b', 'medium'],
          ['c', 'medium'],
          ['d', 'medium'],
        ],
      ),
      { now: during(500) },
    );
    expect(run.status, run.stderr).toBe(0);
    const generated = (await readBundle(run.bundleDir)).schedule.filter(({ puzzleNumber }) => puzzleNumber >= 500);
    expect(generated.map(({ puzzleNumber, noun }) => [puzzleNumber, noun])).toEqual([
      [500, 'c'],
      [501, 'a'],
      [502, 'd'],
      [503, 'b'],
    ]);
  });

  test.each([
    ['easy', 8, ['medium', 'hard']],
    ['hard', 5, ['medium', 'easy']],
    ['medium', 3, ['easy', 'hard']],
  ])('on a day aiming for %s with none eligible, falls back in order and reports it', async (aim, puzzleNumber, fallbacks) => {
    const run = await curate(
      await contentDir(
        () => {},
        fallbacks.map((rating): Added => [`${rating} object`, rating]),
      ),
      { now: during(puzzleNumber) },
    );
    expect(run.status, run.stderr).toBe(0);
    const schedule = (await readBundle(run.bundleDir)).schedule;
    expect([aimFor(puzzleNumber), aimFor(puzzleNumber + 1)]).toEqual([aim, aim]);
    expect(scheduledOn(schedule, puzzleNumber)!.noun).toBe(`${fallbacks[0]} object`);
    expect(scheduledOn(schedule, puzzleNumber + 1)!.noun).toBe(`${fallbacks[1]} object`);
    for (const [day, fallback] of [puzzleNumber, puzzleNumber + 1].map((day, i) => [day, fallbacks[i]])) {
      expect(run.stdout).toMatch(new RegExp(`Puzzle Number ${day} \\(\\w+day\\) aims for ${aim} but takes ${fallback}`));
    }
  });

  test('stops where no object is eligible and still passes, reporting the last Puzzle Number covered and the days short', async () => {
    const run = await curate(await contentDir(() => {}, [['teacup', 'medium']]));
    expect(run.status, run.stderr).toBe(0);
    expect((await readBundle(run.bundleDir)).schedule.map(({ puzzleNumber }) => puzzleNumber)).toEqual([1, 2, 3]);
    expect(run.stdout).toContain(
      'assigned through Puzzle Number 3, 88 days short of the Planning Horizon (Puzzle Number 91)',
    );
  });

  test('produces the same Schedule from the same input', async () => {
    const dir = await contentDir(() => {}, plenty);
    const [one, two] = await Promise.all([curate(dir, { seed: 's' }), curate(dir, { seed: 's' })]);
    expect((await readBundle(one.bundleDir)).schedule).toEqual((await readBundle(two.bundleDir)).schedule);
  });

  test('breaks ties by the seed', async () => {
    const dir = await contentDir(() => {}, plenty);
    const [one, two] = await Promise.all([curate(dir, { seed: 'one' }), curate(dir, { seed: 'two' })]);
    expect((await readBundle(one.bundleDir)).schedule).not.toEqual((await readBundle(two.bundleDir)).schedule);
  });
});

describe.concurrent('Content input files', () => {
  const inputFiles = ['guess-vocabulary.json', 'answer-pool.json', 'pins.json', 'schedule.json'];

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
