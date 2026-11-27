// The stage-authoring tool's headless render, driven as a command-line tool on
// a content directory whose Answer Pool object has recorded Stage Cameras,
// then carried through the curation build into the scoring API. Needs a
// Chromium with WebGL (software rendering is enough); skipped without one.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildApp, loadContent, memoryResultCounters } from '@objectle/api';
import type { GameResponse } from '@objectle/shared';
import { stageAssetProblems } from '@objectle/shared/stage-assets';
import { chromiumPath } from '../src/chromium.ts';
import { caddy, caddyModel, labelV } from './fixture-model.ts';

const authoringCli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const curationCli = fileURLToPath(new URL('../../curation/src/cli.ts', import.meta.url));

type Json = any;

function run(cli: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? ((error.code as number) ?? 1) : 0, stdout, stderr });
    });
  });
}

const wrongGuesses = ['kettle', 'paperclip', 'tennis ball', 'house brick', 'rubber duck'];

/** Stage Cameras for the caddy: stages 1 and 3 look at its back (-Z) and left (-X), never at the label (+Z). */
const camera = (position: number[], target = [0, 0, 0], fov = 30) => ({ position, target, fov });
const fair = {
  // 7 cm from the back face, a 20° frame is about 2.5 cm square: wholly inside the 10 × 16 cm face.
  1: camera([0, 0, -0.12], [0, 0, 0], 20),
  2: camera([0.3, 0.15, -0.4]),
  3: camera([-0.25, 0.1, -0.3], [0, 0, 0], 25),
  4: camera([-0.3, 0.2, -0.35]),
  5: camera([0.3, 0.2, 0.4]),
};

function answerPoolEntry(cameras: Record<number, Json> = {}, textMarks: Json[] = [{ material: 1, uv: [0, 0, 1, 1] }]) {
  const stages = { ...fair, ...cameras };
  return {
    noun: 'tea caddy',
    difficultyRating: 'medium',
    textMarks,
    revealStages: [1, 2, 3, 4, 5].map((stage) => ({ stageCamera: stages[stage as keyof typeof stages] })),
  };
}

async function contentDir(entry: Json = answerPoolEntry()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-render-'));
  await mkdir(join(dir, 'models'));
  const nouns = ['tea caddy', ...wrongGuesses];
  await writeFile(
    join(dir, 'guess-vocabulary.json'),
    JSON.stringify(
      nouns.map((name) => ({
        name,
        model: `models/${name.replaceAll(' ', '-')}.glb`,
        category: 'Cooking & Dining',
        size: 0.16,
        naturalOrMade: 'made',
        primaryMaterial: 'metal',
        credit: { author: `Author of ${name}`, source: 'test', license: 'CC0-1.0' },
      })),
    ),
  );
  for (const [index, name] of nouns.entries()) {
    await writeFile(join(dir, `models/${name.replaceAll(' ', '-')}.glb`), caddyModel([0.5, 0.2 + index / 20, 0.1]));
  }
  await writeFile(join(dir, 'answer-pool.json'), JSON.stringify([entry]));
  await writeFile(join(dir, 'pins.json'), '[]');
  return dir;
}

const readJson = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));

/** The JSON chunk of a binary glTF. */
const glbJson = (bytes: Buffer) => JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));

describe.skipIf(chromiumPath() === undefined)('rendering recorded Stage Cameras headlessly', { timeout: 60_000 }, () => {
  test('renders every Reveal Stage, which the curation build accepts and the game serves stage by stage', async () => {
    const dir = await contentDir();
    const rendered = await run(authoringCli, ['render', dir]);
    expect(rendered.stderr).toBe('');
    expect(rendered.code).toBe(0);

    const [entry] = await readJson(dir, 'answer-pool.json');
    expect(entry.revealStages).toHaveLength(6);
    expect(entry.revealStages.slice(0, 5).map((stage: Json) => stage.stageCamera)).toEqual(Object.values(fair));
    const assets = await Promise.all(entry.revealStages.map((stage: Json) => readFile(join(dir, stage.assets[0]))));
    assets.forEach((bytes, index) => expect(stageAssetProblems(index + 1, bytes)).toEqual([]));
    expect(new Set(assets.map((bytes) => bytes.toString('base64'))).size).toBe(6);

    // Stage 6 carries the stage-5 Stage Camera, so free orbit starts from the stage-5 view (ADR-0006).
    const model = glbJson(assets[5]);
    const cameraNode = model.nodes.find((node: Json) => node.camera !== undefined);
    expect(cameraNode.translation.map((x: number) => +x.toFixed(4))).toEqual(fair[5].position);
    expect(model.cameras[cameraNode.camera].perspective.yfov).toBeCloseTo((fair[5].fov * Math.PI) / 180);
    expect(model.cameras[cameraNode.camera].perspective.aspectRatio).toBe(1);
    expect(model.materials).toHaveLength(2);

    const bundleDir = join(dir, 'bundle');
    const clock = ['--launch-date', '2027-03-01', '--now', '2027-03-01T12:00:00-08:00', '--first-publish'];
    const built = await run(curationCli, [...clock, dir, bundleDir]);
    expect(built.stderr).toBe('');
    expect(built.code).toBe(0);

    const api = buildApp({
      clock: () => new Date('2027-03-01T12:00:00-08:00'),
      launchDate: '2027-03-01',
      content: await loadContent(bundleDir),
      signingKey: 'test-signing-key-test-signing-key',
      resultCounters: memoryResultCounters(),
    });
    let game = (await api.inject({ method: 'POST', url: '/api/game', payload: {} })).json<GameResponse>();
    for (const [index, guess] of [...wrongGuesses, null].entries()) {
      expect(game.revealStage).toBe(index + 1);
      const served = await Promise.all(
        game.stageAssets.map(async ({ url }) => (await api.inject({ method: 'GET', url })).rawPayload),
      );
      expect(served).toEqual([assets[index]]);
      if (guess === null) break;
      game = (await api.inject({ method: 'POST', url: '/api/guess', payload: { playToken: game.playToken, guess } })).json();
    }
    expect(game.stageAssets.map(({ mediaType }) => mediaType)).toEqual(['model/gltf-binary']);
  });

  test('refuses a Reveal Stage 1 Stage Camera that frames background, and writes nothing', async () => {
    const entry = answerPoolEntry({ 1: camera([0, 0, -0.5]) });
    const dir = await contentDir(entry);
    const rendered = await run(authoringCli, ['render', dir]);
    expect(rendered.code).toBe(1);
    expect(rendered.stderr).toContain('"tea caddy" Reveal Stage 1 Stage Camera frames background');
    expect(await readJson(dir, 'answer-pool.json')).toEqual([entry]);
  });

  test('refuses a Reveal Stage 1-3 Stage Camera that frames marked text', async () => {
    const dir = await contentDir(answerPoolEntry({ 3: camera([0.1, 0.05, 0.4]) }));
    const rendered = await run(authoringCli, ['render', dir]);
    expect(rendered.code).toBe(1);
    expect(rendered.stderr).toContain('"tea caddy" Reveal Stage 3 Stage Camera frames marked text');
  });

  test('checks only the marked part of a material, and only where the Stage Camera can see it', async () => {
    // A tight crop of the label's upper part, 7 cm in front of it.
    const y = 0.05;
    const crop = { 1: camera([0, y, caddy.depth / 2 + 0.07], [0, y, 0], 20) };
    const [top, bottom] = [labelV(y + 0.02), labelV(y - 0.02)];

    const unseen = await run(authoringCli, ['render', await contentDir(answerPoolEntry(crop, [{ material: 1, uv: [0, 0.5, 1, 1] }]))]);
    expect(unseen.stderr).toBe('');
    expect(unseen.code).toBe(0);

    const seen = await run(authoringCli, ['render', await contentDir(answerPoolEntry(crop, [{ material: 1, uv: [0, top, 1, bottom] }]))]);
    expect(seen.stderr).toContain('"tea caddy" Reveal Stage 1 Stage Camera frames marked text');
  });

  test('lists a model that fails to load as its object’s problem and still renders the other objects', async () => {
    const dir = await contentDir();
    await writeFile(join(dir, 'models/kettle.glb'), 'not a model');
    await writeFile(join(dir, 'answer-pool.json'), JSON.stringify([{ ...answerPoolEntry(), noun: 'kettle' }, answerPoolEntry()]));
    const rendered = await run(authoringCli, ['render', dir]);
    expect(rendered.code).toBe(1);
    expect(rendered.stderr).toMatch(/^Answer Pool object "kettle" .+/m);
    expect(rendered.stderr).not.toContain('rendering failed');
    const [kettle, teaCaddy] = await readJson(dir, 'answer-pool.json');
    expect(kettle.revealStages[0].assets).toBeUndefined();
    expect(teaCaddy.revealStages).toHaveLength(6);
  });

  test('renders only the nouns named, if any', async () => {
    const dir = await contentDir();
    const rendered = await run(authoringCli, ['render', dir, 'kettle']);
    expect(rendered.code).toBe(1);
    expect(rendered.stderr).toContain('kettle has no recorded Stage Cameras');
  });
});
