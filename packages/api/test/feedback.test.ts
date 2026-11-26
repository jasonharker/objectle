// Feedback on a wrong Guess's four Attributes, and its Ghost, through the
// scoring API's HTTP interface.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ContentBundle, Feedback, GameResponse, GuessVocabularyEntry } from '@objectle/shared';
import { copyFixture, fixtureDir, playGuesses, resumeGame, startGame } from './harness.ts';

// Launch Date 2027-03-01. Puzzle Number 1's Daily Object is the teapot
// (kitchenware, 0.24 m, made, ceramic); Puzzle Number 2's is the pinecone
// (plant, 0.09 m, natural, wood).
const day1 = '2027-03-01T20:00:00Z';
const day2 = '2027-03-02T20:00:00Z';

async function fixtureBundle(): Promise<ContentBundle> {
  return JSON.parse(await readFile(join(fixtureDir, 'bundle.json'), 'utf8'));
}

async function newGame(now: string, contentDir?: string) {
  const { api, response } = await startGame({ now, contentDir });
  return { api, game: response.json<GameResponse>() };
}

async function feedbackFor(now: string, guess: string, contentDir?: string): Promise<Feedback> {
  const { api, game } = await newGame(now, contentDir);
  const [next] = await playGuesses(api, game.playToken, [guess]);
  return next.wrongGuesses[0].feedback;
}

describe('Feedback', () => {
  test.each<[string, string, Feedback]>([
    [day1, 'wooden spoon', { category: 'match', size: 'similar', naturalOrMade: 'match', primaryMaterial: 'no match' }],
    [day1, 'pinecone', { category: 'no match', size: 'bigger', naturalOrMade: 'no match', primaryMaterial: 'no match' }],
    [day1, 'claw hammer', { category: 'no match', size: 'smaller', naturalOrMade: 'match', primaryMaterial: 'no match' }],
    [day2, 'wooden spoon', { category: 'no match', size: 'smaller', naturalOrMade: 'no match', primaryMaterial: 'match' }],
    [day2, 'rubber duck', { category: 'no match', size: 'similar', naturalOrMade: 'no match', primaryMaterial: 'no match' }],
    [day2, 'tennis ball', { category: 'no match', size: 'bigger', naturalOrMade: 'no match', primaryMaterial: 'no match' }],
  ])('on %s, a Guess of %s reads %o', async (now, guess, expected) => {
    expect(await feedbackFor(now, guess)).toEqual(expected);
  });

  describe('size', () => {
    // Nouns sized exactly at, and just past, 1.25 times each Daily Object's Size.
    const boundaryNouns: Record<string, number> = {
      'teapot ÷ 1.25': 0.192,
      'just under teapot ÷ 1.25': 0.1919,
      'teapot × 1.25': 0.3,
      'just over teapot × 1.25': 0.3001,
      'pinecone ÷ 1.25': 0.072,
      'just under pinecone ÷ 1.25': 0.0719,
      'pinecone × 1.25': 0.1125,
      'just over pinecone × 1.25': 0.1126,
    };

    async function boundaryFixture(): Promise<string> {
      const dir = await copyFixture();
      const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
      const template = bundle.guessVocabulary.find(({ name }) => name === 'rubber duck')!;
      for (const [n, [name, size]] of Object.entries(boundaryNouns).entries()) {
        const model = `models/boundary-${n}.glb`;
        await copyFile(join(dir, template.model), join(dir, model));
        bundle.guessVocabulary.push({ ...template, name, size, model } satisfies GuessVocabularyEntry);
      }
      await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle));
      return dir;
    }

    test.each([
      [day1, 'teapot ÷ 1.25', 'similar'],
      [day1, 'just under teapot ÷ 1.25', 'bigger'],
      [day1, 'teapot × 1.25', 'similar'],
      [day1, 'just over teapot × 1.25', 'smaller'],
      [day2, 'pinecone ÷ 1.25', 'similar'],
      [day2, 'just under pinecone ÷ 1.25', 'bigger'],
      [day2, 'pinecone × 1.25', 'similar'],
      [day2, 'just over pinecone × 1.25', 'smaller'],
    ])('on %s, a Guess sized "%s" reads %s', async (now, guess, size) => {
      expect((await feedbackFor(now, guess, await boundaryFixture())).size).toBe(size);
    });

    test('is computed on exact Sizes, not on the rounded relative size the Ghost carries', async () => {
      const { api, game } = await newGame(day1, await boundaryFixture());
      const [, next] = await playGuesses(api, game.playToken, ['teapot ÷ 1.25', 'just under teapot ÷ 1.25']);
      expect(next.wrongGuesses.map(({ ghost }) => ghost.relativeSize)).toEqual([0.8, 0.8]);
      expect(next.wrongGuesses.map(({ feedback }) => feedback.size)).toEqual(['similar', 'bigger']);
    });
  });

  test('is identical for the same Guess across requests and games', async () => {
    const first = await feedbackFor(day1, 'claw hammer');
    const second = await feedbackFor(day1, 'claw hammer');
    expect(second).toEqual(first);

    const { api, game } = await newGame(day1);
    const games = await playGuesses(api, game.playToken, ['rubber duck', 'claw hammer']);
    expect(games[1].wrongGuesses[1].feedback).toEqual(first);
    expect(games[1].wrongGuesses[0]).toEqual(games[0].wrongGuesses[0]);
  });
});

describe('Earlier Guesses', () => {
  const wrong = ['wooden spoon', 'claw hammer', 'rubber duck'];

  test('every wrong Guess so far is listed, in order, with its Feedback', async () => {
    const { api, game } = await newGame(day1);
    expect(game.wrongGuesses).toEqual([]);
    const games = await playGuesses(api, game.playToken, wrong);
    expect(games.at(-1)!.wrongGuesses.map(({ guess }) => guess)).toEqual(wrong);
    for (const [n, g] of games.entries()) {
      expect(g.wrongGuesses).toEqual(games.at(-1)!.wrongGuesses.slice(0, n + 1));
    }
  });

  test('stay listed with their Feedback after a reload', async () => {
    const { api, game } = await newGame(day1);
    const played = (await playGuesses(api, game.playToken, wrong)).at(-1)!;
    const resumed = (await resumeGame(api, played.playToken)).json<GameResponse>();
    expect(played.wrongGuesses).toHaveLength(wrong.length);
    expect(resumed.wrongGuesses).toEqual(played.wrongGuesses);
  });

  test('stay listed once the game is solved, and the correct Guess is not among them', async () => {
    const { api, game } = await newGame(day1);
    const end = (await playGuesses(api, game.playToken, [...wrong, 'teapot'])).at(-1)!;
    expect(end.result).toEqual({ solved: true, revealStage: 4 });
    expect(end.wrongGuesses.map(({ guess }) => guess)).toEqual(wrong);
    expect((await resumeGame(api, end.playToken)).json<GameResponse>().wrongGuesses).toEqual(end.wrongGuesses);
  });
});

describe('Ghosts', () => {
  test('a wrong Guess’s Ghost serves that noun’s model as binary glTF', async () => {
    const { api, game } = await newGame(day1);
    const [next] = await playGuesses(api, game.playToken, ['claw hammer']);
    const model = await api.inject({ method: 'GET', url: next.wrongGuesses[0].ghost.url });
    expect(model.statusCode).toBe(200);
    expect(model.headers['content-type']).toBe('model/gltf-binary');
    expect(model.rawPayload).toEqual(await readFile(join(fixtureDir, 'models/claw-hammer.glb')));
  });

  // Two significant figures: enough to draw the Ghost, not enough to recover
  // the Daily Object's exact Size from one Guess.
  test('a Ghost’s relative size is its Size as a multiple of the Daily Object’s, to two significant figures', async () => {
    // Teapot 0.24 m: claw hammer 0.33 / 0.24 = 1.375, paperclip 0.033 / 0.24 = 0.1375.
    const { api, game } = await newGame(day1);
    const games = await playGuesses(api, game.playToken, ['claw hammer', 'paperclip']);
    expect(games[1].wrongGuesses.map(({ ghost }) => ghost.relativeSize)).toEqual([1.4, 0.14]);
  });

  test('a Ghost’s model URL names no noun and is the same whatever the Daily Object', async () => {
    const urls: string[] = [];
    for (const now of [day1, day2]) {
      const { api, game } = await newGame(now);
      const [next] = await playGuesses(api, game.playToken, ['rubber duck']);
      urls.push(next.wrongGuesses[0].ghost.url);
    }
    expect(urls[1]).toBe(urls[0]);
    const bundle = await fixtureBundle();
    for (const noun of bundle.guessVocabulary) {
      expect(urls[0]).not.toContain(noun.name.split(' ')[0]);
      expect(urls[0]).not.toContain(noun.model);
    }
  });
});
