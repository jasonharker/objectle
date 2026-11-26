// Proves the client talks to the scoring API correctly, against the real API
// run in-process by the seam-1 harness.
import { expect, test } from 'vitest';
import { startApi } from '../../api/test/harness.ts';
import { startGame } from '../src/game.ts';

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
  };
}

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
