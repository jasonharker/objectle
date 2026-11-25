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

export function buildApp({ clock, launchDate }: Dependencies) {
  const app = Fastify();

  app.post('/api/game', async (): Promise<GameResponse> => {
    return { playToken: '', puzzleNumber: puzzleNumberAt(clock(), launchDate), revealStage: 1, stageAssets: [] };
  });

  return app;
}
