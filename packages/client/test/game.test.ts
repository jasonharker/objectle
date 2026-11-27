// Proves the client talks to the scoring API correctly, against the real API
// run in-process by the seam-1 harness.
import { Box3, Vector3, type Object3D } from 'three';
import { describe, expect, test } from 'vitest';
import { startApi } from '../../api/test/harness.ts';
import { loadCredits, loadGuessVocabulary, outageMessage, startGame, submitGuess } from '../src/game.ts';
import { dailyObjectModel, loadModel, modelMediaType } from '../src/model-loader.ts';
import { hiddenDailyObject, scaleToLongestDimension } from '../src/stage-view.ts';

async function apiFetch(now: string): Promise<typeof fetch> {
  const api = await startApi({ now });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await api.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: String(input),
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(new Uint8Array(response.rawPayload), {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    });
  }) as typeof fetch;
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const day2 = '2027-03-02T20:00:00Z'; // Puzzle Number 2: the pinecone

test('starts today’s game and stores the Play Token locally', async () => {
  const fetch = await apiFetch('2027-03-02T20:00:00Z');
  const storage = memoryStorage();

  const game = await startGame(fetch, storage);

  expect(game.puzzleNumber).toBe(2);
  expect(game.revealStage).toBe(1);
  expect(storage.getItem('objectle.playToken')).toBe(game.playToken);
  const asset = await fetch(game.stageAssets[0].url);
  expect(asset.status).toBe(200);
});

test('reports a failed start instead of storing anything', async () => {
  const fetch = await apiFetch('2027-02-01T20:00:00Z'); // before the Launch Date
  const storage = memoryStorage();

  await expect(startGame(fetch, storage)).rejects.toThrow();
  expect(storage.getItem('objectle.playToken')).toBeNull();
});

test('loads the Guess Vocabulary names for suggestions', async () => {
  const names = await loadGuessVocabulary(await apiFetch(day2));
  expect(names).toContain('pinecone');
  expect(names).toContain('wooden spoon');
});

test('a Guess stores the updated Play Token', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);

  const game = await submitGuess(fetch, storage, 'teapot');

  expect(game.revealStage).toBe(2);
  expect(storage.getItem('objectle.playToken')).toBe(game.playToken);
});

test('resumes the stored game after a reload', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);
  const played = await submitGuess(fetch, storage, 'teapot');

  const resumed = await startGame(fetch, storage);

  expect(resumed).toEqual(played);
});

test('a wrong Guess comes back with its Feedback, which a reload keeps', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);
  const played = await submitGuess(fetch, storage, 'wooden spoon');

  expect(played.wrongGuesses.map(({ guess, feedback }) => [guess, feedback])).toEqual([
    ['wooden spoon', { category: 'no match', size: 'smaller', naturalOrMade: 'no match', primaryMaterial: 'match' }],
  ]);
  expect((await startGame(fetch, storage)).wrongGuesses).toEqual(played.wrongGuesses);
});

test('a Ghost loads at true relative scale beside the hidden Daily Object', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);
  const { wrongGuesses } = await submitGuess(fetch, storage, 'wooden spoon');
  const { ghost } = wrongGuesses[0];

  const model = scaleToLongestDimension(await loadModel(fetch, ghost.url), ghost.relativeSize);

  const longest = (object: Object3D) => Math.max(...new Box3().setFromObject(object).getSize(new Vector3()).toArray());
  // No stylesheet in Node to take the ball's colour from, and its size is all that counts here.
  expect(longest(model) / longest(hiddenDailyObject(0))).toBeCloseTo(ghost.relativeSize, 6);
});

test('a refused Guess says why and keeps the Play Token', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  const game = await startGame(fetch, storage);

  await expect(submitGuess(fetch, storage, 'kettle')).rejects.toThrow(/Guess Vocabulary/);
  expect(storage.getItem('objectle.playToken')).toBe(game.playToken);
});

test('drops a stored Play Token the API rejects and starts a fresh game', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  storage.setItem('objectle.playToken', 'not a play token');

  const game = await startGame(fetch, storage);

  expect(game.revealStage).toBe(1);
  expect(storage.getItem('objectle.playToken')).toBe(game.playToken);
});

test('a Guess with a stored Play Token the API rejects drops it and starts a fresh game', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  storage.setItem('objectle.playToken', 'not a play token');

  const game = await submitGuess(fetch, storage, 'teapot');

  expect(game.revealStage).toBe(1);
  expect(game.guesses).toEqual([]);
  expect(storage.getItem('objectle.playToken')).toBe(game.playToken);
});

test('Reveal Stages 1–5 are images; stage 6 is a model with its Stage Camera and the first letter', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  const games = [await startGame(fetch, storage)];
  for (const guess of ['teapot', 'wooden spoon', 'claw hammer', 'rubber duck', 'tennis ball']) {
    games.push(await submitGuess(fetch, storage, guess));
  }

  expect(games.map((game) => game.stageAssets.map(({ mediaType }) => mediaType))).toEqual([
    ...Array(5).fill(['image/webp']),
    [modelMediaType],
  ]);
  expect(games.map(dailyObjectModel)).toEqual([undefined, undefined, undefined, undefined, undefined, games[5].stageAssets[0].url]);
  expect(games[5].firstLetter).toBe('p');
  const model = await loadModel(fetch, dailyObjectModel(games[5])!);
  expect(model.getObjectByProperty('isCamera', true)).toBeDefined();
});

test('once the game ends, the Daily Object’s model loads whatever Reveal Stage it ended at', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);
  await submitGuess(fetch, storage, 'teapot');
  const end = await submitGuess(fetch, storage, 'pinecone');

  expect(end.revealStage).toBe(2);
  const model = await loadModel(fetch, dailyObjectModel(end)!);
  expect(new Box3().setFromObject(model).isEmpty()).toBe(false);
});

test('the Guess that ends the game brings the end-of-game payload', async () => {
  const fetch = await apiFetch(day2);
  const storage = memoryStorage();
  await startGame(fetch, storage);
  await submitGuess(fetch, storage, 'teapot');

  const end = await submitGuess(fetch, storage, 'pinecone');

  expect(end.result).toEqual({ solved: true, revealStage: 2 });
  expect(end.endOfGame?.dailyObject.name).toBe('pinecone');
  expect(end.endOfGame?.ghostCredits.map(({ name }) => name)).toEqual(['teapot']);
  expect(end.endOfGame?.distribution).toEqual({ solved: [0, 1, 0, 0, 0, 0], failed: 0 });
  expect(end.endOfGame?.beatPercentage).toBeNull();
});

test('loads every model’s Credit for the credits page', async () => {
  const credits = await loadCredits(await apiFetch(day2));
  expect(credits.map(({ name }) => name)).toContain('wooden spoon');
  expect(credits.find(({ name }) => name === 'pinecone')?.credit.author).toBe('Fixture Author B');
});

describe('when the API cannot be reached', () => {
  const unreachable = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const badGateway = (async () => new Response('Bad Gateway', { status: 502 })) as typeof fetch;

  test.each([
    ['unreachable', unreachable],
    ['behind a failing proxy', badGateway],
  ])('every call reports an outage (%s)', async (_, fetch) => {
    const storage = memoryStorage();
    storage.setItem('objectle.playToken', 'stored');
    await expect(startGame(fetch, storage)).rejects.toThrow(outageMessage);
    await expect(submitGuess(fetch, storage, 'teapot')).rejects.toThrow(outageMessage);
    await expect(loadGuessVocabulary(fetch)).rejects.toThrow(outageMessage);
    await expect(loadCredits(fetch)).rejects.toThrow(outageMessage);
    expect(storage.getItem('objectle.playToken')).toBe('stored');
  });
});
