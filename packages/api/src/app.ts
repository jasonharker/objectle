import Fastify from 'fastify';
import type { GameResponse } from '@objectle/shared';
import type { Content } from './content.ts';
import { puzzleNumberAt } from './puzzle-clock.ts';

export { loadContent } from './content.ts';
export type { Content } from './content.ts';

export interface Dependencies {
  clock: () => Date;
  /** Pacific date of Puzzle Number 1, YYYY-MM-DD. */
  launchDate: string;
  content: Content;
  signingKey: string;
}

export function buildApp({ clock, launchDate, content }: Dependencies) {
  const app = Fastify();

  app.post('/api/game', async (_request, reply) => {
    const puzzleNumber = puzzleNumberAt(clock(), launchDate);
    if (puzzleNumber < 1) return reply.code(404).send({ error: 'Objectle has not launched yet.' });

    const scheduled = content.bundle.schedule.find((entry) => entry.puzzleNumber === puzzleNumber);
    if (!scheduled) return reply.code(503).send({ error: 'No Daily Object is scheduled for today.' });

    const response: GameResponse = { playToken: '', puzzleNumber, revealStage: 1, stageAssets: [] };
    return response;
  });

  return app;
}
