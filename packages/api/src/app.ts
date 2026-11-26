import { readFile } from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type {
  ErrorResponse,
  GameRequest,
  GameResponse,
  GuessRequest,
  GuessVocabularyResponse,
  Result,
  WrongGuess,
} from '@objectle/shared';
import { revealStageCount, type Content } from './content.ts';
import { feedback } from './feedback.ts';
import { signPlayToken, verifyPlayToken, type Progress } from './play-token.ts';
import { puzzleNumberAt } from './puzzle-clock.ts';

export { loadContent } from './content.ts';
export type { Content } from './content.ts';

export interface Dependencies {
  clock: () => Date;
  /** Pacific date of Puzzle Number 1, YYYY-MM-DD. */
  launchDate: string;
  content: Content;
  signingKey: string;
  /** The built client, served from the same origin; omitted in API-only tests. */
  clientDir?: string;
  logger?: boolean;
}

const invalidPlayToken: ErrorResponse = { error: 'The Play Token is not valid.' };

export function buildApp({ clock, launchDate, content, signingKey, clientDir, logger = false }: Dependencies) {
  const app = Fastify({ logger });
  if (clientDir) app.register(fastifyStatic, { root: clientDir });

  const vocabulary = new Set(content.bundle.guessVocabulary.map(({ name }) => name));
  // Sorted, so the order says nothing about which nouns are in the Answer Pool.
  const guessVocabulary: GuessVocabularyResponse = { names: [...vocabulary].sort() };

  /** The active Puzzle Number, or why no game can be played right now. */
  const active = (): { puzzleNumber: number } | { status: number; body: ErrorResponse } => {
    const puzzleNumber = puzzleNumberAt(clock(), launchDate);
    if (puzzleNumber < 1) return { status: 404, body: { error: 'Objectle has not launched yet.' } };
    if (!content.dailyObject(puzzleNumber)) {
      return { status: 503, body: { error: 'No Daily Object is scheduled for today.' } };
    }
    return { puzzleNumber };
  };

  /** The Reveal Stage a game is at and its Result, from the Guesses so far. */
  const play = ({ puzzleNumber, guesses }: Progress): { revealStage: number; result: Result | null } => {
    const solvedAt = guesses.indexOf(content.dailyObject(puzzleNumber)!) + 1;
    if (solvedAt > 0) return { revealStage: solvedAt, result: { solved: true, revealStage: solvedAt } };
    if (guesses.length >= revealStageCount) return { revealStage: revealStageCount, result: { solved: false } };
    return { revealStage: guesses.length + 1, result: null };
  };

  /** Feedback and a Ghost for each wrong Guess. A correct Guess has neither. */
  const wrongGuesses = ({ puzzleNumber, guesses }: Progress): WrongGuess[] => {
    const dailyObject = content.noun(content.dailyObject(puzzleNumber)!)!;
    return guesses
      .filter((guess) => guess !== dailyObject.name)
      .map((guess) => {
        const noun = content.noun(guess)!;
        return {
          guess,
          feedback: feedback(noun, dailyObject),
          ghost: { url: `/api/models/${content.modelOf(guess)!.id}`, relativeSize: noun.size / dailyObject.size },
        };
      });
  };

  const position = (progress: Progress): GameResponse => {
    const { revealStage, result } = play(progress);
    const assets = content.revealStages(progress.puzzleNumber)![revealStage - 1];
    return {
      playToken: signPlayToken(progress, signingKey),
      puzzleNumber: progress.puzzleNumber,
      revealStage,
      stageAssets: assets.map(({ id }) => ({ url: `/api/stage-assets/${id}` })),
      guesses: progress.guesses,
      result,
      wrongGuesses: wrongGuesses(progress),
    };
  };

  const freshGame = (puzzleNumber: number) => position({ puzzleNumber, guesses: [] });

  app.get('/api/guess-vocabulary', async () => guessVocabulary);

  // Start or resume. A Play Token for any other Puzzle Number gets a fresh game.
  app.post<{ Body: GameRequest | null }>('/api/game', async (request, reply) => {
    const today = active();
    if ('status' in today) return reply.code(today.status).send(today.body);

    const playToken = request.body?.playToken;
    if (playToken === undefined) return freshGame(today.puzzleNumber);
    const progress = verifyPlayToken(playToken, signingKey);
    if (!progress) return reply.code(400).send(invalidPlayToken);
    return progress.puzzleNumber === today.puzzleNumber ? position(progress) : freshGame(today.puzzleNumber);
  });

  // A Guess is scored only for the active Puzzle Number; a Play Token for any
  // other gets a fresh game, unscored.
  app.post<{ Body: Partial<GuessRequest> | null }>('/api/guess', async (request, reply) => {
    const today = active();
    if ('status' in today) return reply.code(today.status).send(today.body);

    const progress = verifyPlayToken(request.body?.playToken, signingKey);
    if (!progress) return reply.code(400).send(invalidPlayToken);
    if (progress.puzzleNumber !== today.puzzleNumber) return freshGame(today.puzzleNumber);
    if (play(progress).result) return reply.code(409).send({ error: 'This game has ended.' });

    const guess = request.body?.guess;
    if (typeof guess !== 'string' || !vocabulary.has(guess)) {
      return reply.code(422).send({ error: 'That Guess is not in the Guess Vocabulary.' });
    }
    if (progress.guesses.includes(guess)) {
      return reply.code(422).send({ error: `You already guessed ${guess}; it does not count again.` });
    }
    return position({ puzzleNumber: progress.puzzleNumber, guesses: [...progress.guesses, guess] });
  });

  // Asset ids are content hashes, so a later Reveal Stage's asset cannot be
  // fetched before a response has named it. A game started just before
  // midnight Pacific keeps its asset URLs after rollover, so the previous
  // Puzzle Number's assets are served too. A later Puzzle Number's never are.
  app.get<{ Params: { id: string } }>('/api/stage-assets/:id', async (request, reply) => {
    const active = puzzleNumberAt(clock(), launchDate);
    const asset = [active, active - 1]
      .flatMap((puzzleNumber) => content.revealStages(puzzleNumber)?.flat() ?? [])
      .find(({ id }) => id === request.params.id);
    if (!asset) return reply.code(404).send({ error: 'No such stage asset.' });
    return reply.type(asset.mediaType).send(await readFile(asset.file));
  });

  // Ghost models. Any Guess Vocabulary model is served by its content hash,
  // whatever the Daily Object, so neither a URL nor whether it is served says
  // anything about the Daily Object. A URL is only ever named for a wrong Guess.
  app.get<{ Params: { id: string } }>('/api/models/:id', async (request, reply) => {
    const model = content.modelById(request.params.id);
    if (!model) return reply.code(404).send({ error: 'No such model.' });
    return reply.type(model.mediaType).send(await readFile(model.file));
  });

  return app;
}
