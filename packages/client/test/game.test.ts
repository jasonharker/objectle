// Proves the client talks to the scoring API correctly, against the real API
// run in-process by the seam-1 harness.
import { describe, expect, test } from 'vitest';
import { startApi } from '../../api/test/harness.ts';
import { loadGuessVocabulary, outageMessage, startGame, submitGuess } from '../src/game.ts';

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
    expect(storage.getItem('objectle.playToken')).toBe('stored');
  });
});
