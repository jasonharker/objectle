import type { GameResponse } from '@objectle/shared';

export const playTokenKey = 'objectle.playToken';

type TokenStorage = Pick<Storage, 'setItem'>;

/** Start today's game on the scoring API and keep its Play Token locally. */
export async function startGame(fetchFn: typeof fetch, storage: TokenStorage): Promise<GameResponse> {
  const response = await fetchFn('/api/game', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`The game service answered ${response.status}`);
  const game: GameResponse = await response.json();
  storage.setItem(playTokenKey, game.playToken);
  return game;
}
