import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ContentBundle, CreditsResponse, GameResponse, Result } from '@objectle/shared';
import { memoryResultCounters, type ResultCounters } from '../src/app.ts';
import { fixtureDir, playGuesses, resumeGame, startApi, startGame, submitGuess } from './harness.ts';

// Launch Date 2027-03-01: Puzzle Number 1, whose Daily Object is the teapot.
const day1 = '2027-03-01T20:00:00Z';
const daily = 'teapot';
// Six wrong Guesses that are not scheduled on any day of the fixture.
const wrong = ['wooden spoon', 'claw hammer', 'rubber duck', 'tennis ball', 'paperclip', 'house brick'];

async function fixtureBundle(): Promise<ContentBundle> {
  return JSON.parse(await readFile(join(fixtureDir, 'bundle.json'), 'utf8'));
}

async function creditOf(name: string) {
  return (await fixtureBundle()).guessVocabulary.find((entry) => entry.name === name)!.credit;
}

/** The Guesses that end a game with this Result. */
function guessesFor(result: Result): string[] {
  return result.solved ? [...wrong.slice(0, result.revealStage - 1), daily] : wrong;
}

/** Play one whole game on Puzzle Number 1 to the given Result, returning its last response. */
async function finish(api: Awaited<ReturnType<typeof startApi>>, result: Result): Promise<GameResponse> {
  const game = (await api.inject({ method: 'POST', url: '/api/game', payload: {} })).json<GameResponse>();
  return (await playGuesses(api, game.playToken, guessesFor(result))).at(-1)!;
}

/** Counters already holding other players' finished games on Puzzle Number 1. */
async function countersWith(others: [Result, number][], puzzleNumber = 1): Promise<ResultCounters> {
  const counters = memoryResultCounters();
  for (const [result, count] of others) {
    for (let i = 0; i < count; i++) await counters.increment(puzzleNumber, result);
  }
  return counters;
}

const solvedAt = (revealStage: number): Result => ({ solved: true, revealStage });
const failed: Result = { solved: false };

describe('The end-of-game payload', () => {
  test('a game still being played has none', async () => {
    const { api, response } = await startGame({ now: day1 });
    const game = response.json<GameResponse>();
    expect(game.endOfGame).toBeNull();
    const [next] = await playGuesses(api, game.playToken, [wrong[0]]);
    expect(next.endOfGame).toBeNull();
  });

  test('a solved game names the Daily Object with its Credit and the Credit of each Ghost, in Guess order', async () => {
    const api = await startApi({ now: day1 });
    const end = await finish(api, solvedAt(3));
    expect(end.endOfGame).toMatchObject({
      dailyObject: { name: daily, credit: await creditOf(daily) },
      ghostCredits: [
        { name: wrong[0], credit: await creditOf(wrong[0]) },
        { name: wrong[1], credit: await creditOf(wrong[1]) },
      ],
    });
  });

  test('a failed game names the Daily Object and credits all six Ghosts', async () => {
    const api = await startApi({ now: day1 });
    const end = await finish(api, failed);
    expect(end.endOfGame!.dailyObject).toEqual({ name: daily, credit: await creditOf(daily) });
    expect(end.endOfGame!.ghostCredits).toEqual(
      await Promise.all(wrong.map(async (name) => ({ name, credit: await creditOf(name) }))),
    );
  });

  test.each([solvedAt(1), solvedAt(4), failed])(
    'names Reveal Stage 6’s assets, so the Daily Object can be drawn beside its Ghosts (%o)',
    async (result) => {
      const api = await startApi({ now: day1 });
      const stage6 = (await finish(api, failed)).stageAssets;
      const end = await finish(api, result);
      expect(end.endOfGame!.lastStageAssets).toEqual(stage6);
      const asset = await api.inject({ method: 'GET', url: end.endOfGame!.lastStageAssets[0].url });
      expect(asset.rawPayload).toEqual(await readFile(join(fixtureDir, 'assets/teapot-stage-6.glb')));
    },
  );

  test('a game solved at Reveal Stage 1 has no Ghost Credits', async () => {
    const api = await startApi({ now: day1 });
    expect((await finish(api, solvedAt(1))).endOfGame!.ghostCredits).toEqual([]);
  });

  test('before the game ends, no response discloses the Daily Object, its Credit, any Credit or the Schedule', async () => {
    const bundle = await fixtureBundle();
    const noun = bundle.guessVocabulary.find(({ name }) => name === daily)!;
    // Attribute values are matched as whole words: Feedback's own field names
    // contain them ("made" in naturalOrMade).
    const attributes = [noun.category, noun.primaryMaterial, noun.naturalOrMade, String(noun.size)];
    const secrets = [
      noun.name,
      noun.model,
      ...bundle.guessVocabulary.flatMap(({ credit }) => [credit.author, credit.source, credit.license]),
      ...bundle.answerPool.flatMap((entry) => entry.revealStages.flatMap((stage) => stage.assets)),
    ];

    // Other players have finished already, so there is a Distribution to leak.
    const api = await startApi({ now: day1, resultCounters: await countersWith([[solvedAt(2), 3], [failed, 1]]) });
    const fresh = await api.inject({ method: 'POST', url: '/api/game', payload: {} });
    const games = await playGuesses(api, fresh.json<GameResponse>().playToken, wrong.slice(0, 5));
    const last = games.at(-1)!.playToken;
    const responses = [
      fresh.body,
      ...games.map((g) => JSON.stringify(g)),
      (await submitGuess(api, last, wrong[0])).body, // repeated Guess
      (await submitGuess(api, last, 'kettle')).body, // not in the Guess Vocabulary
      (await resumeGame(api, last)).body,
      ...(await Promise.all(
        games.flatMap((g) => g.stageAssets).map(async ({ url }) => (await api.inject({ method: 'GET', url })).body),
      )),
    ];
    const disclosed = responses.join('\n').toLowerCase();

    for (const secret of secrets) expect(disclosed).not.toContain(secret.toLowerCase());
    for (const value of attributes) {
      expect(disclosed).not.toMatch(new RegExp(`\\b${value.toLowerCase().replaceAll('.', '\\.')}\\b`));
    }
    expect(disclosed).not.toContain('schedule');
    expect(disclosed).not.toContain('distribution');
  });
});

describe('Distribution and Beat Percentage', () => {
  test('the first player to finish is in the Distribution and has no Beat Percentage', async () => {
    const api = await startApi({ now: day1 });
    const { endOfGame } = await finish(api, solvedAt(2));
    expect(endOfGame!.distribution).toEqual({ solved: [0, 1, 0, 0, 0, 0], failed: 0 });
    expect(endOfGame!.beatPercentage).toBeNull();
  });

  // Hand-computed: Beat Percentage = 100 × (others worse + ½ × others with the
  // same Result) / others. "Others" are the finished games other than the player's.
  test.each<[string, [Result, number][], Result, { solved: number[]; failed: number }, number]>([
    // Others: 1@1 2@2 3@3 1@6 2 failed = 9. Worse than @3: 1@6 + 2 failed = 3. Same: 3.
    // (3 + 1.5) / 9 = 50%.
    [
      'solved at 3 among a spread of Results',
      [[solvedAt(1), 1], [solvedAt(2), 2], [solvedAt(3), 3], [solvedAt(6), 1], [failed, 2]],
      solvedAt(3),
      { solved: [1, 2, 4, 0, 0, 1], failed: 2 },
      50,
    ],
    // Others: 3@2 + 1 failed = 4. Worse than failed: none. Same: 1. 0.5 / 4 = 12.5%.
    ['failed', [[solvedAt(2), 3], [failed, 1]], failed, { solved: [0, 3, 0, 0, 0, 0], failed: 2 }, 12.5],
    // Others: 1@1 + 3@4 = 4. Worse than @1: 3. Same: 1. 3.5 / 4 = 87.5%.
    ['solved at 1', [[solvedAt(1), 1], [solvedAt(4), 3]], solvedAt(1), { solved: [2, 0, 0, 3, 0, 0], failed: 0 }, 87.5],
    // Others: 2@2, all ties. 1 / 2 = 50%.
    ['solved at 2 among only ties', [[solvedAt(2), 2]], solvedAt(2), { solved: [0, 3, 0, 0, 0, 0], failed: 0 }, 50],
    // Others: 4@1, all better. 0%.
    ['solved at 6 behind everyone', [[solvedAt(1), 4]], solvedAt(6), { solved: [4, 0, 0, 0, 0, 1], failed: 0 }, 0],
    // Others: 2 failed, all worse. 100%.
    ['solved at 5 ahead of everyone', [[failed, 2]], solvedAt(5), { solved: [0, 0, 0, 0, 1, 0], failed: 2 }, 100],
  ])('%s', async (_, others, result, distribution, beatPercentage) => {
    const api = await startApi({ now: day1, resultCounters: await countersWith(others) });
    const { endOfGame } = await finish(api, result);
    expect(endOfGame!.distribution).toEqual(distribution);
    expect(endOfGame!.beatPercentage).toBe(beatPercentage);
  });

  test('another Puzzle Number’s finished games do not count', async () => {
    const counters = await countersWith([[solvedAt(1), 5], [failed, 5]], 2);
    const api = await startApi({ now: day1, resultCounters: counters });
    const { endOfGame } = await finish(api, solvedAt(4));
    expect(endOfGame!.distribution).toEqual({ solved: [0, 0, 0, 1, 0, 0], failed: 0 });
    expect(endOfGame!.beatPercentage).toBeNull();
  });

  test('games finished through the API count toward each other', async () => {
    const api = await startApi({ now: day1 });
    await finish(api, solvedAt(1));
    await finish(api, failed);
    const { endOfGame } = await finish(api, solvedAt(4));
    // Others: 1@1 + 1 failed. Worse than @4: 1. 1 / 2 = 50%.
    expect(endOfGame!.distribution).toEqual({ solved: [1, 0, 0, 1, 0, 0], failed: 1 });
    expect(endOfGame!.beatPercentage).toBe(50);
  });

  test('a resumed finished game gets the figures for every game finished so far', async () => {
    const api = await startApi({ now: day1 });
    const mine = await finish(api, solvedAt(2));
    expect(mine.endOfGame!.beatPercentage).toBeNull();

    await finish(api, failed);
    await finish(api, solvedAt(1));
    const resumed = (await resumeGame(api, mine.playToken)).json<GameResponse>();
    // Others: 1@1 + 1 failed. Worse than @2: 1. 1 / 2 = 50%.
    expect(resumed.endOfGame!.distribution).toEqual({ solved: [1, 1, 0, 0, 0, 0], failed: 1 });
    expect(resumed.endOfGame!.beatPercentage).toBe(50);
    expect(resumed.endOfGame!.dailyObject).toEqual(mine.endOfGame!.dailyObject);
  });
});

describe('Result counters', () => {
  test('count a finished game once: resuming it or Guessing again after it ended adds nothing', async () => {
    const api = await startApi({ now: day1 });
    const end = await finish(api, solvedAt(3));
    for (let i = 0; i < 3; i++) {
      expect((await resumeGame(api, end.playToken)).statusCode).toBe(200);
      expect((await submitGuess(api, end.playToken, 'pinecone')).statusCode).toBe(409);
    }
    const resumed = (await resumeGame(api, end.playToken)).json<GameResponse>();
    expect(resumed.endOfGame!.distribution).toEqual({ solved: [0, 0, 1, 0, 0, 0], failed: 0 });
  });

  test('the finishing Guess needs no separate Distribution read, so no failed read can make a retry count it twice', async () => {
    const counters = memoryResultCounters();
    const unreadable: ResultCounters = {
      increment: (puzzleNumber, result) => counters.increment(puzzleNumber, result),
      distribution: async () => {
        throw new Error('the Distribution cannot be read');
      },
    };
    const api = await startApi({ now: day1, resultCounters: unreadable });
    const end = await finish(api, solvedAt(2));
    expect(end.endOfGame!.distribution).toEqual({ solved: [0, 1, 0, 0, 0, 0], failed: 0 });
    expect(await counters.distribution(1)).toEqual({ solved: [0, 1, 0, 0, 0, 0], failed: 0 });
  });

  test('a game still being played is not counted', async () => {
    const counters = memoryResultCounters();
    const api = await startApi({ now: day1, resultCounters: counters });
    const game = (await api.inject({ method: 'POST', url: '/api/game', payload: {} })).json<GameResponse>();
    await playGuesses(api, game.playToken, wrong.slice(0, 5));
    expect(await counters.distribution(1)).toEqual({ solved: [0, 0, 0, 0, 0, 0], failed: 0 });
  });

  test('are the only state kept between requests: another API instance sharing them continues any game', async () => {
    // Two replicas share only the Result counters and the signing key.
    const counters = memoryResultCounters();
    const first = await startApi({ now: day1, resultCounters: counters });
    const second = await startApi({ now: day1, resultCounters: counters });

    const game = (await first.inject({ method: 'POST', url: '/api/game', payload: {} })).json<GameResponse>();
    const [mid] = await playGuesses(second, game.playToken, [wrong[0]]);
    const [end] = await playGuesses(first, mid.playToken, [daily]);
    await finish(second, failed);

    const resumed = (await resumeGame(second, end.playToken)).json<GameResponse>();
    expect(resumed.result).toEqual(solvedAt(2));
    expect(resumed.endOfGame!.distribution).toEqual({ solved: [0, 1, 0, 0, 0, 0], failed: 1 });
    expect(resumed.endOfGame!.beatPercentage).toBe(100);
  });
});

describe('The credits page', () => {
  test('lists every Guess Vocabulary model’s Credit, alphabetically by name', async () => {
    const bundle = await fixtureBundle();
    const api = await startApi({ now: day1 });
    const response = await api.inject({ method: 'GET', url: '/api/credits' });
    expect(response.statusCode).toBe(200);
    const expected = bundle.guessVocabulary
      .map(({ name, credit }) => ({ name, credit }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(response.json<CreditsResponse>()).toEqual({ credits: expected });
  });

  test('says nothing about the Answer Pool or the Attributes', async () => {
    const api = await startApi({ now: day1 });
    const body = (await api.inject({ method: 'GET', url: '/api/credits' })).body;
    for (const word of ['inAnswerPool', 'category', 'primaryMaterial', 'naturalOrMade', 'size', 'model', '.glb']) {
      expect(body).not.toContain(word);
    }
  });
});
