import { readFile } from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { GameResponse } from '@objectle/shared';
import type { Content } from './content.ts';
import { signPlayToken } from './play-token.ts';
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

export function buildApp({ clock, launchDate, content, signingKey, clientDir, logger = false }: Dependencies) {
  const app = Fastify({ logger });
  if (clientDir) app.register(fastifyStatic, { root: clientDir });

  /** Reveal Stage 1's assets of the Daily Object scheduled for a Puzzle Number. */
  const stageOneAssets = (puzzleNumber: number) => content.revealStages(puzzleNumber)?.[0];

  app.post('/api/game', async (_request, reply) => {
    const puzzleNumber = puzzleNumberAt(clock(), launchDate);
    if (puzzleNumber < 1) return reply.code(404).send({ error: 'Objectle has not launched yet.' });

    const assets = stageOneAssets(puzzleNumber);
    if (!assets) return reply.code(503).send({ error: 'No Daily Object is scheduled for today.' });

    const response: GameResponse = {
      playToken: signPlayToken({ puzzleNumber, guesses: [] }, signingKey),
      puzzleNumber,
      revealStage: 1,
      stageAssets: assets.map(({ id }) => ({ url: `/api/stage-assets/${id}` })),
    };
    return response;
  });

  app.get<{ Params: { id: string } }>('/api/stage-assets/:id', async (request, reply) => {
    const asset = stageOneAssets(puzzleNumberAt(clock(), launchDate))?.find(({ id }) => id === request.params.id);
    if (!asset) return reply.code(404).send({ error: 'No such stage asset.' });
    return reply.type(asset.mediaType).send(await readFile(asset.file));
  });

  return app;
}
