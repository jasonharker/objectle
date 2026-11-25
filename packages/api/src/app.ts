import { createHash } from 'node:crypto';
import { extname } from 'node:path';
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

const mediaTypes: Record<string, string> = { '.svg': 'image/svg+xml' };

// A stage asset is identified by the hash of its bytes, so neither its URL
// nor its payload carries the noun or the bundle's file name.
const assetId = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function buildApp({ clock, launchDate, content }: Dependencies) {
  const app = Fastify();

  /** Reveal Stage 1's assets of the active Daily Object, keyed by asset id. */
  function activeStageAssets(puzzleNumber: number) {
    const scheduled = content.bundle.schedule.find((entry) => entry.puzzleNumber === puzzleNumber);
    const dailyObject = content.bundle.answerPool.find((entry) => entry.noun === scheduled?.noun);
    if (!dailyObject) return undefined;
    const assets = new Map<string, { bytes: Buffer; mediaType: string }>();
    for (const path of dailyObject.revealStages[0].assets) {
      const bytes = content.assets.get(path)!;
      assets.set(assetId(bytes), { bytes, mediaType: mediaTypes[extname(path)] ?? 'application/octet-stream' });
    }
    return assets;
  }

  app.post('/api/game', async (_request, reply) => {
    const puzzleNumber = puzzleNumberAt(clock(), launchDate);
    if (puzzleNumber < 1) return reply.code(404).send({ error: 'Objectle has not launched yet.' });

    const assets = activeStageAssets(puzzleNumber);
    if (!assets) return reply.code(503).send({ error: 'No Daily Object is scheduled for today.' });

    const response: GameResponse = {
      playToken: '',
      puzzleNumber,
      revealStage: 1,
      stageAssets: [...assets.keys()].map((id) => ({ url: `/api/stage-assets/${id}` })),
    };
    return response;
  });

  app.get<{ Params: { id: string } }>('/api/stage-assets/:id', async (request, reply) => {
    const asset = activeStageAssets(puzzleNumberAt(clock(), launchDate))?.get(request.params.id);
    if (!asset) return reply.code(404).send({ error: 'No such stage asset.' });
    return reply.type(asset.mediaType).send(asset.bytes);
  });

  return app;
}
