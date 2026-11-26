// Seam 1: the scoring API in-process, with an injected clock, the fixture
// content bundle and a test signing key. Tests talk to it only over HTTP.
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '@objectle/curation';
import { buildApp, loadContent, memoryResultCounters, type ResultCounters } from '../src/app.ts';
import type { GameResponse } from '@objectle/shared';

/** The fixture content bundle, built by the curation build from the fixture content directory. */
export const fixtureDir = await buildFixture();

async function buildFixture(): Promise<string> {
  const bundleDir = join(await mkdtemp(join(tmpdir(), 'objectle-fixture-')), 'bundle');
  // Built on its Launch Date, which keeps the fixture's short Schedule as written.
  const { problems } = await buildContent(fileURLToPath(new URL('./fixture/', import.meta.url)), bundleDir, {
    launchDate: '2027-03-01',
    now: new Date('2027-03-01T12:00:00-08:00'),
  });
  if (problems.length > 0) throw new Error(`the fixture content does not build:\n${problems.join('\n')}`);
  return bundleDir;
}
export const testSigningKey = 'test-signing-key-test-signing-key';

export interface Options {
  /** The injected clock's current instant, as an ISO timestamp, or a function returning it on each call. */
  now: string | (() => string);
  launchDate?: string;
  signingKey?: string;
  clientDir?: string;
  /** A content bundle directory other than the fixture. */
  contentDir?: string;
  /** Result counters to share between API instances or seed with other players' games; fresh in-memory ones by default. */
  resultCounters?: ResultCounters;
}

/** A writable copy of the fixture content bundle. */
export async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-content-'));
  await cp(fixtureDir, dir, { recursive: true });
  return dir;
}

export async function startApi({
  now,
  launchDate = '2027-03-01',
  signingKey = testSigningKey,
  clientDir,
  contentDir = fixtureDir,
  resultCounters = memoryResultCounters(),
}: Options) {
  return buildApp({
    clock: () => new Date(typeof now === 'function' ? now() : now),
    launchDate,
    content: await loadContent(contentDir),
    signingKey,
    clientDir,
    resultCounters,
  });
}

/** Start a new game the way the client does, returning the raw response. */
export async function startGame(options: Options) {
  const api = await startApi(options);
  const response = await api.inject({ method: 'POST', url: '/api/game', payload: {} });
  return { api, response };
}

type Api = Awaited<ReturnType<typeof startApi>>;

/** Resume a game from a Play Token the way the client does after a reload. */
export function resumeGame(api: Api, playToken: string) {
  return api.inject({ method: 'POST', url: '/api/game', payload: { playToken } });
}

/** Submit a Guess with a Play Token, returning the raw response. */
export function submitGuess(api: Api, playToken: string, guess: string) {
  return api.inject({ method: 'POST', url: '/api/guess', payload: { playToken, guess } });
}

/** Submit Guesses one after another, each with the Play Token the previous one returned. */
export async function playGuesses(api: Api, playToken: string, guesses: string[]): Promise<GameResponse[]> {
  const games: GameResponse[] = [];
  for (const guess of guesses) {
    const response = await submitGuess(api, playToken, guess);
    if (response.statusCode !== 200) throw new Error(`Guess "${guess}": status ${response.statusCode}: ${response.body}`);
    const game = response.json<GameResponse>();
    games.push(game);
    playToken = game.playToken;
  }
  return games;
}

export async function puzzleNumberAt(now: string, launchDate?: string): Promise<number> {
  const { response } = await startGame({ now, launchDate });
  if (response.statusCode !== 200) throw new Error(`status ${response.statusCode}: ${response.body}`);
  return response.json<GameResponse>().puzzleNumber;
}
