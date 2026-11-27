// Seam 1: the scoring API in-process, with an injected clock, the fixture
// content bundle and a test signing key. Tests talk to it only over HTTP.
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '@objectle/curation';
import { buildApp, buildMetricsApp, loadContent, memoryResultCounters, type ResultCounters } from '../src/app.ts';
import type { GameResponse } from '@objectle/shared';

const fixtures = new Map<string, Promise<string>>();

/**
 * The fixture content bundle built for a Launch Date, by the curation build
 * from the fixture content directory; the API refuses one built for another.
 */
function fixtureFor(launchDate: string): Promise<string> {
  if (!fixtures.has(launchDate)) fixtures.set(launchDate, buildFixture(launchDate));
  return fixtures.get(launchDate)!;
}

/** The fixture content bundle, built for the Launch Date 2027-03-01. */
export const fixtureDir = await fixtureFor('2027-03-01');

async function buildFixture(launchDate: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-fixture-'));
  const bundleDir = join(dir, 'bundle');
  // The fixture's previously published bundle, as if published for this
  // Launch Date: the build refuses one built for another.
  const published = JSON.parse(await readFile(new URL('./fixture/published/bundle.json', import.meta.url), 'utf8'));
  await mkdir(join(dir, 'published'));
  await writeFile(join(dir, 'published', 'bundle.json'), JSON.stringify({ ...published, launchDate }));
  // Built on its Launch Date, which keeps the short Schedule of the fixture's
  // previously published bundle as written.
  const { problems } = await buildContent(fileURLToPath(new URL('./fixture/', import.meta.url)), bundleDir, {
    launchDate,
    now: new Date(`${launchDate}T12:00:00-08:00`),
    previousBundle: join(dir, 'published'),
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
  /** A content bundle directory other than the fixture built for the Launch Date. */
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
  contentDir,
  resultCounters = memoryResultCounters(),
}: Options) {
  contentDir ??= await fixtureFor(launchDate);
  return buildApp({
    clock: () => new Date(typeof now === 'function' ? now() : now),
    launchDate,
    content: await loadContent(contentDir, { launchDate }),
    signingKey,
    clientDir,
    resultCounters,
  });
}

/** The metrics listener, with the same injected clock and content as `startApi`. */
export async function startMetrics({ now, launchDate = '2027-03-01', contentDir }: Options) {
  contentDir ??= await fixtureFor(launchDate);
  return buildMetricsApp({
    clock: () => new Date(typeof now === 'function' ? now() : now),
    launchDate,
    content: await loadContent(contentDir, { launchDate }),
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
