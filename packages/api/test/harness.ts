// Seam 1: the scoring API in-process, with an injected clock, the hand-written
// content fixture and a test signing key. Tests talk to it only over HTTP.
import { fileURLToPath } from 'node:url';
import { buildApp, loadContent } from '../src/app.ts';
import type { GameResponse } from '@objectle/shared';

export const fixtureDir = fileURLToPath(new URL('./fixture/', import.meta.url));
export const testSigningKey = 'test-signing-key-test-signing-key';

export interface Options {
  /** The injected clock's current instant, as an ISO timestamp. */
  now: string;
  launchDate?: string;
  signingKey?: string;
  clientDir?: string;
}

export async function startApi({ now, launchDate = '2027-03-01', signingKey = testSigningKey, clientDir }: Options) {
  return buildApp({
    clock: () => new Date(now),
    launchDate,
    content: await loadContent(fixtureDir),
    signingKey,
    clientDir,
  });
}

/** Start a new game the way the client does, returning the raw response. */
export async function startGame(options: Options) {
  const api = await startApi(options);
  const response = await api.inject({ method: 'POST', url: '/api/game', payload: {} });
  return { api, response };
}

export async function puzzleNumberAt(now: string, launchDate?: string): Promise<number> {
  const { response } = await startGame({ now, launchDate });
  if (response.statusCode !== 200) throw new Error(`status ${response.statusCode}: ${response.body}`);
  return response.json<GameResponse>().puzzleNumber;
}
