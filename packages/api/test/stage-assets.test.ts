import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ContentBundle, GameResponse } from '@objectle/shared';
import { copyFixture, fixtureDir, startGame } from './harness.ts';

// Launch Date 2027-03-01, so these instants are Puzzle Numbers 1, 2 and 3.
const days = ['2027-03-01T20:00:00Z', '2027-03-02T20:00:00Z', '2027-03-03T20:00:00Z'];

async function fixtureBundle(): Promise<ContentBundle> {
  return JSON.parse(await readFile(join(fixtureDir, 'bundle.json'), 'utf8'));
}

describe('A new game', () => {
  test('starts at Reveal Stage 1 with the Daily Object’s stage-1 asset', async () => {
    const { api, response } = await startGame({ now: days[0] });
    const game = response.json<GameResponse>();
    expect(game.revealStage).toBe(1);
    expect(game.stageAssets).toHaveLength(1);

    const asset = await api.inject({ method: 'GET', url: game.stageAssets[0].url });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toBe('image/svg+xml');
    expect(asset.rawPayload).toEqual(await readFile(join(fixtureDir, 'assets/teapot-stage-1.svg')));
  });

  test('gets the next day’s Daily Object after rollover', async () => {
    const { api, response } = await startGame({ now: days[1] });
    const asset = await api.inject({ method: 'GET', url: response.json<GameResponse>().stageAssets[0].url });
    expect(asset.rawPayload).toEqual(await readFile(join(fixtureDir, 'assets/pinecone-stage-1.svg')));
  });

  test('reads a stage asset’s bytes from the bundle when it is requested, not at startup', async () => {
    const contentDir = await copyFixture();
    const { api, response } = await startGame({ now: days[0], contentDir });
    const edited = '<svg xmlns="http://www.w3.org/2000/svg"><!-- edited after startup --></svg>';
    await writeFile(join(contentDir, 'assets/teapot-stage-1.svg'), edited);

    const asset = await api.inject({ method: 'GET', url: response.json<GameResponse>().stageAssets[0].url });
    expect(asset.body).toBe(edited);
  });

  test('says each stage asset’s media type, so the client knows a model from an image', async () => {
    const contentDir = await copyFixture();
    const bundle = await fixtureBundle();
    bundle.answerPool.find((entry) => entry.noun === 'teapot')!.revealStages[0].assets.push('models/teapot.glb');
    await writeFile(join(contentDir, 'bundle.json'), JSON.stringify(bundle));

    const { response } = await startGame({ now: days[0], contentDir });

    expect(response.json<GameResponse>().stageAssets.map(({ mediaType }) => mediaType)).toEqual([
      'image/svg+xml',
      'model/gltf-binary',
    ]);
  });

  test('keeps serving a game’s stage assets across midnight Pacific rollover', async () => {
    // 2027-03-02T08:00Z is midnight Pacific (PST) between Puzzle Numbers 1 and 2.
    let now = '2027-03-02T07:59:59Z';
    const { api, response } = await startGame({ now: () => now });
    const game = response.json<GameResponse>();
    expect(game.puzzleNumber).toBe(1);

    now = '2027-03-02T08:00:01Z';
    const asset = await api.inject({ method: 'GET', url: game.stageAssets[0].url });
    expect(asset.statusCode).toBe(200);
    expect(asset.rawPayload).toEqual(await readFile(join(fixtureDir, 'assets/teapot-stage-1.svg')));
  });

  test('stops serving a game’s stage assets once the following Puzzle Number has ended', async () => {
    let now = days[1];
    const { api, response } = await startGame({ now: () => now });
    const { url } = response.json<GameResponse>().stageAssets[0];

    now = '2027-03-04T07:59:59Z'; // still Puzzle Number 3
    expect((await api.inject({ method: 'GET', url })).statusCode).toBe(200);
    now = '2027-03-04T08:00:00Z'; // Puzzle Number 4
    expect((await api.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  test('cannot fetch the next Daily Object’s stage asset, even a second before midnight', async () => {
    const tomorrow = (await startGame({ now: days[1] })).response.json<GameResponse>();
    const { api } = await startGame({ now: '2027-03-02T07:59:59Z' });
    const asset = await api.inject({ method: 'GET', url: tomorrow.stageAssets[0].url });
    expect(asset.statusCode).toBe(404);
  });

  test.each(days)('never discloses the Daily Object, its Attributes or the Schedule (%s)', async (now) => {
    const bundle = await fixtureBundle();
    const { api, response } = await startGame({ now });
    const game = response.json<GameResponse>();
    const assetBodies = await Promise.all(
      game.stageAssets.map(async ({ url }) => (await api.inject({ method: 'GET', url })).body),
    );
    const disclosed = [response.body, ...assetBodies].join('\n').toLowerCase();

    const scheduled = bundle.guessVocabulary.filter((noun) =>
      bundle.schedule.some((entry) => entry.noun === noun.name),
    );
    const secrets = scheduled.flatMap((noun) => [
      noun.name,
      noun.category,
      noun.primaryMaterial,
      noun.naturalOrMade,
      String(noun.size),
      noun.model,
      noun.credit.author,
    ]);
    const assetPaths = bundle.answerPool.flatMap((entry) => entry.revealStages.flatMap((stage) => stage.assets));
    for (const secret of [...secrets, ...assetPaths]) {
      expect(disclosed).not.toContain(secret.toLowerCase());
    }
    expect(disclosed).not.toContain('schedule');
  });
});
