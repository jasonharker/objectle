import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ContentBundle, GameResponse } from '@objectle/shared';
import { copyFixture, fixtureDir, playGuesses, resumeGame, startApi, startGame, submitGuess } from './harness.ts';

// Launch Date 2027-03-01: Puzzle Number 1, whose Daily Object is the teapot.
const day1 = '2027-03-01T20:00:00Z';
const daily = 'teapot';
// Six wrong Guesses that are not scheduled on any day of the fixture.
const wrong = ['wooden spoon', 'claw hammer', 'rubber duck', 'tennis ball', 'paperclip', 'house brick'];

async function fixtureBundle(): Promise<ContentBundle> {
  return JSON.parse(await readFile(join(fixtureDir, 'bundle.json'), 'utf8'));
}

async function newGame(now: string | (() => string) = day1) {
  const { api, response } = await startGame({ now });
  return { api, game: response.json<GameResponse>() };
}

describe('Guess Vocabulary', () => {
  test('ships every Guess Vocabulary name, alphabetically, and nothing else', async () => {
    const bundle = await fixtureBundle();
    const api = await startApi({ now: day1 });
    const response = await api.inject({ method: 'GET', url: '/api/guess-vocabulary' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ names: bundle.guessVocabulary.map(({ name }) => name).sort() });
  });
});

describe('A Guess', () => {
  test('a new game has no Guesses and no Result', async () => {
    const { game } = await newGame();
    expect(game.guesses).toEqual([]);
    expect(game.result).toBeNull();
  });

  test('a wrong Guess advances to Reveal Stage 2 with its assets', async () => {
    const { api, game } = await newGame();
    const [next] = await playGuesses(api, game.playToken, [wrong[0]]);
    expect(next.revealStage).toBe(2);
    expect(next.guesses).toEqual([wrong[0]]);
    expect(next.result).toBeNull();

    const asset = await api.inject({ method: 'GET', url: next.stageAssets[0].url });
    expect(asset.statusCode).toBe(200);
    expect(asset.rawPayload).toEqual(await readFile(join(fixtureDir, 'assets/teapot-stage-2.webp')));
  });

  test('each wrong Guess advances exactly one Reveal Stage, up to Reveal Stage 6', async () => {
    const { api, game } = await newGame();
    const games = await playGuesses(api, game.playToken, wrong.slice(0, 5));
    expect(games.map((g) => g.revealStage)).toEqual([2, 3, 4, 5, 6]);
    expect(games.every((g) => g.result === null)).toBe(true);
  });

  test.each([1, 2, 3, 4, 5, 6])('a correct Guess at Reveal Stage %i ends the game solved there', async (stage) => {
    const { api, game } = await newGame();
    const games = await playGuesses(api, game.playToken, [...wrong.slice(0, stage - 1), daily]);
    const end = games.at(-1)!;
    expect(end.result).toEqual({ solved: true, revealStage: stage });
    expect(end.revealStage).toBe(stage);
  });

  test('a sixth wrong Guess ends the game failed', async () => {
    const { api, game } = await newGame();
    const end = (await playGuesses(api, game.playToken, wrong)).at(-1)!;
    expect(end.result).toEqual({ solved: false });
    expect(end.guesses).toEqual(wrong);
  });

  test.each([
    ['solved', [daily]],
    ['failed', wrong],
  ])('no Guess is accepted once the game has ended %s', async (_, guesses) => {
    const { api, game } = await newGame();
    const end = (await playGuesses(api, game.playToken, guesses)).at(-1)!;
    const response = await submitGuess(api, end.playToken, 'pinecone');
    expect(response.statusCode).toBe(409);
  });

  test('a Guess outside the Guess Vocabulary is rejected and does not use up a Guess', async () => {
    const { api, game } = await newGame();
    const rejected = await submitGuess(api, game.playToken, 'kettle');
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toMatch(/Guess Vocabulary/);

    const [next] = await playGuesses(api, game.playToken, [wrong[0]]);
    expect(next.revealStage).toBe(2);
    expect(next.guesses).toEqual([wrong[0]]);
  });

  test('a noun already guessed is refused without counting as a Guess', async () => {
    const { api, game } = await newGame();
    const [first] = await playGuesses(api, game.playToken, [wrong[0]]);
    const repeated = await submitGuess(api, first.playToken, wrong[0]);
    expect(repeated.statusCode).toBe(422);
    expect(repeated.json().error).toMatch(/already guessed/);

    const [next] = await playGuesses(api, first.playToken, [wrong[1]]);
    expect(next.revealStage).toBe(3);
    expect(next.guesses).toEqual([wrong[0], wrong[1]]);
  });
});

describe('The Play Token', () => {
  async function tamperedTokens() {
    const { api, game } = await newGame();
    const [, signature] = game.playToken.split('.');
    const forged = Buffer.from(JSON.stringify({ puzzleNumber: 1, guesses: wrong.slice(0, 5) })).toString('base64url');
    const otherKey = (await startGame({ now: day1, signingKey: 'other-signing-key-other-signing-key' })).response;
    return {
      api,
      tokens: {
        'an edited payload': `${forged}.${signature}`,
        'a wrong signing key': otherKey.json<GameResponse>().playToken,
        'no signature': forged,
        garbage: 'not a play token',
      },
    };
  }

  test('a tampered or wrongly signed Play Token is rejected when guessing', async () => {
    const { api, tokens } = await tamperedTokens();
    for (const [label, token] of Object.entries(tokens)) {
      const response = await submitGuess(api, token, daily);
      expect(response.statusCode, label).toBe(400);
      expect(response.body, label).not.toContain('playToken');
    }
  });

  test('a tampered or wrongly signed Play Token is rejected when resuming', async () => {
    const { api, tokens } = await tamperedTokens();
    for (const [label, token] of Object.entries(tokens)) {
      expect((await resumeGame(api, token)).statusCode, label).toBe(400);
    }
  });

  test('a Play Token with a Guess a content redeploy dropped from the Guess Vocabulary is rejected, not a 500', async () => {
    const { api, game } = await newGame();
    const [played] = await playGuesses(api, game.playToken, [wrong[1]]);

    const contentDir = await copyFixture();
    const bundle = await fixtureBundle();
    bundle.guessVocabulary = bundle.guessVocabulary.filter(({ name }) => name !== wrong[1]);
    await writeFile(join(contentDir, 'bundle.json'), JSON.stringify(bundle));
    const redeployed = await startApi({ now: day1, contentDir });

    expect((await resumeGame(redeployed, played.playToken)).statusCode).toBe(400);
    expect((await submitGuess(redeployed, played.playToken, wrong[0])).statusCode).toBe(400);
  });

  test('a Guess without a Play Token is rejected', async () => {
    const api = await startApi({ now: day1 });
    const response = await api.inject({ method: 'POST', url: '/api/guess', payload: { guess: daily } });
    expect(response.statusCode).toBe(400);
  });

  test('a Play Token for a past Puzzle Number gets a fresh game for the active one when resuming', async () => {
    let now = day1;
    const { api, game } = await newGame(() => now);
    const [played] = await playGuesses(api, game.playToken, [wrong[0]]);

    now = '2027-03-02T20:00:00Z';
    const fresh = (await resumeGame(api, played.playToken)).json<GameResponse>();
    expect(fresh.puzzleNumber).toBe(2);
    expect(fresh.revealStage).toBe(1);
    expect(fresh.guesses).toEqual([]);
    expect(fresh.result).toBeNull();
  });

  test('a Guess with a Play Token for a past Puzzle Number is not scored and gets a fresh game', async () => {
    let now = day1;
    const { api, game } = await newGame(() => now);

    now = '2027-03-02T20:00:00Z'; // Puzzle Number 2: the pinecone
    const response = await submitGuess(api, game.playToken, 'pinecone');
    expect(response.statusCode).toBe(200);
    const fresh = response.json<GameResponse>();
    expect(fresh.puzzleNumber).toBe(2);
    expect(fresh.revealStage).toBe(1);
    expect(fresh.guesses).toEqual([]);
    expect(fresh.result).toBeNull();
  });
});

describe('Reloading', () => {
  test('mid-game restores the same position', async () => {
    const { api, game } = await newGame();
    const played = (await playGuesses(api, game.playToken, wrong.slice(0, 2))).at(-1)!;
    const resumed = await resumeGame(api, played.playToken);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json<GameResponse>()).toEqual(played);
  });

  test.each([
    ['solved', [wrong[0], daily]],
    ['failed', wrong],
  ])('after the game ended %s restores the same Result', async (_, guesses) => {
    const { api, game } = await newGame();
    const end = (await playGuesses(api, game.playToken, guesses)).at(-1)!;
    const resumed = (await resumeGame(api, end.playToken)).json<GameResponse>();
    expect(resumed).toEqual(end);
    expect(resumed.result).not.toBeNull();
  });
});

describe('Reveal Stages', () => {
  test('a response for Reveal Stage N names no asset of a later Reveal Stage', async () => {
    const { api, game } = await newGame();
    const games = [game, ...(await playGuesses(api, game.playToken, wrong.slice(0, 5)))];
    const bodies = games.map((g) => JSON.stringify(g));
    for (const [n, g] of games.entries()) {
      for (const later of games.slice(n + 1)) {
        for (const { url } of later.stageAssets) expect(bodies[n]).not.toContain(url);
      }
      expect(g.revealStage).toBe(n + 1);
    }
  });

  test('only Reveal Stage 6 shows the first letter of the Daily Object’s name', async () => {
    const { api, game } = await newGame();
    const games = [game, ...(await playGuesses(api, game.playToken, wrong.slice(0, 5)))];
    expect(games.map((g) => g.firstLetter)).toEqual([null, null, null, null, null, 't']);
  });

  test('each Reveal Stage serves that stage’s own assets: images through stage 5, a model at stage 6', async () => {
    const { revealStages } = (await fixtureBundle()).answerPool.find(({ noun }) => noun === daily)!;
    const { api, game } = await newGame();
    const games = [game, ...(await playGuesses(api, game.playToken, wrong.slice(0, 5)))];
    for (const g of games) {
      const asset = await api.inject({ method: 'GET', url: g.stageAssets[0].url });
      const expected = await readFile(join(fixtureDir, revealStages[g.revealStage - 1].assets[0]));
      expect(asset.rawPayload, `Reveal Stage ${g.revealStage}`).toEqual(expected);
      expect(asset.headers['content-type']).toBe(g.stageAssets[0].mediaType);
    }
    expect(games.map((g) => g.stageAssets.map(({ mediaType }) => mediaType))).toEqual([
      ...Array(5).fill(['image/webp']),
      ['model/gltf-binary'],
    ]);
  });

  describe.each([1, 2, 3, 4, 5])('a response for Reveal Stage %i', (n) => {
    /** Each Reveal Stage's response and the payloads of the assets it names, index 0 being stage 1. */
    async function everyStage() {
      const { api, game } = await newGame();
      const games = [game, ...(await playGuesses(api, game.playToken, wrong.slice(0, 5)))];
      return Promise.all(
        games.map(async (g) => ({
          game: g,
          payloads: await Promise.all(
            g.stageAssets.map(async ({ url }) => (await api.inject({ method: 'GET', url })).rawPayload),
          ),
        })),
      );
    }

    test('serves no payload of a later Reveal Stage', async () => {
      const stages = await everyStage();
      const { payloads } = stages[n - 1];
      for (const later of stages.slice(n)) {
        for (const payload of later.payloads) {
          for (const own of payloads) expect(own.equals(payload)).toBe(false);
        }
      }
    });

    test('shows no first letter, which only Reveal Stage 6 does', async () => {
      const { game } = (await everyStage())[n - 1];
      expect(game.firstLetter).toBeNull();
    });
  });

  test.each([1, 2, 3, 4, 5, 6])('no asset id or payload at Reveal Stage %i contains a noun name', async (n) => {
    const names = (await fixtureBundle()).guessVocabulary.map(({ name }) => name.toLowerCase());
    const { api, game } = await newGame();
    const games = [game, ...(await playGuesses(api, game.playToken, wrong.slice(0, 5)))];
    for (const { url } of games[n - 1].stageAssets) {
      const payload = (await api.inject({ method: 'GET', url })).rawPayload.toString('latin1').toLowerCase();
      for (const name of names) {
        expect(url.toLowerCase()).not.toContain(name);
        expect(payload).not.toContain(name);
        expect(payload).not.toContain(name.replaceAll(' ', '-'));
        expect(payload).not.toContain(name.replaceAll(' ', '_'));
      }
    }
  });

  test('before the game ends, no response discloses the Daily Object, its Attributes or the Schedule', async () => {
    const bundle = await fixtureBundle();
    const noun = bundle.guessVocabulary.find(({ name }) => name === daily)!;
    // Attribute values are matched as whole words: Feedback's own field names
    // contain them ("made" in naturalOrMade).
    const attributes = [noun.category, noun.primaryMaterial, noun.naturalOrMade, String(noun.size)];
    const secrets = [
      noun.name,
      noun.model,
      noun.credit.author,
      ...bundle.answerPool.flatMap((entry) => entry.revealStages.flatMap((stage) => stage.assets)),
    ];

    const { api, game } = await newGame();
    const games = await playGuesses(api, game.playToken, wrong.slice(0, 5));
    const rejected = await submitGuess(api, games.at(-1)!.playToken, wrong[0]);
    const resumed = await resumeGame(api, games.at(-1)!.playToken);
    const assetBodies = await Promise.all(
      games.flatMap((g) => g.stageAssets).map(async ({ url }) => (await api.inject({ method: 'GET', url })).body),
    );
    const disclosed = [...games.map((g) => JSON.stringify(g)), rejected.body, resumed.body, ...assetBodies]
      .join('\n')
      .toLowerCase();

    for (const secret of secrets) expect(disclosed).not.toContain(secret.toLowerCase());
    for (const value of attributes) {
      expect(disclosed).not.toMatch(new RegExp(`\\b${value.toLowerCase().replaceAll('.', '\\.')}\\b`));
    }
    expect(disclosed).not.toContain('schedule');
  });
});
