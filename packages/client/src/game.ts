import type {
  CreditsResponse,
  ErrorResponse,
  GameRequest,
  GameResponse,
  GuessRequest,
  GuessVocabularyResponse,
  ModelCredit,
} from '@objectle/shared';

export const playTokenKey = 'objectle.playToken';

export const outageMessage = 'The game service cannot be reached right now. This is an outage, not your mistake; try again later.';

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The scoring API refused a request; the message says why. */
export class RefusedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Call the scoring API, throwing outageMessage if it cannot be reached and a RefusedError if it refuses. */
async function callApi<T>(fetchFn: typeof fetch, url: string, body?: GameRequest | GuessRequest): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(
      url,
      body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
  } catch {
    throw new Error(outageMessage);
  }
  if (response.status >= 500) throw new Error(outageMessage);
  if (!response.ok) {
    const refusal: Partial<ErrorResponse> = await response.json().catch(() => ({}));
    throw new RefusedError(response.status, refusal.error ?? `The game service answered ${response.status}`);
  }
  return response.json();
}

/** Start today's game, or resume the stored one, and keep its Play Token locally. */
export async function startGame(fetchFn: typeof fetch, storage: TokenStorage): Promise<GameResponse> {
  const playToken = storage.getItem(playTokenKey) ?? undefined;
  let game: GameResponse;
  try {
    game = await callApi<GameResponse>(fetchFn, '/api/game', { playToken });
  } catch (error) {
    // A Play Token the API rejects can never resume a game; start a fresh one.
    if (!(playToken && error instanceof RefusedError && error.status === 400)) throw error;
    storage.removeItem(playTokenKey);
    game = await callApi<GameResponse>(fetchFn, '/api/game', {});
  }
  storage.setItem(playTokenKey, game.playToken);
  return game;
}

/**
 * Submit a Guess with the stored Play Token, and keep the updated one. If the
 * API rejects the stored Play Token, it is dropped and a fresh game started,
 * without the Guess.
 */
export async function submitGuess(fetchFn: typeof fetch, storage: TokenStorage, guess: string): Promise<GameResponse> {
  const playToken = storage.getItem(playTokenKey) ?? '';
  let game: GameResponse;
  try {
    game = await callApi<GameResponse>(fetchFn, '/api/guess', { playToken, guess });
  } catch (error) {
    if (!(error instanceof RefusedError && error.status === 400)) throw error;
    storage.removeItem(playTokenKey);
    return startGame(fetchFn, storage);
  }
  storage.setItem(playTokenKey, game.playToken);
  return game;
}

/** The Guess Vocabulary names, for suggestions. */
export async function loadGuessVocabulary(fetchFn: typeof fetch): Promise<string[]> {
  return (await callApi<GuessVocabularyResponse>(fetchFn, '/api/guess-vocabulary')).names;
}

/** Every model's Credit, for the credits page. */
export async function loadCredits(fetchFn: typeof fetch): Promise<ModelCredit[]> {
  return (await callApi<CreditsResponse>(fetchFn, '/api/credits')).credits;
}
