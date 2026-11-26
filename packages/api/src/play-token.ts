import { createHmac } from 'node:crypto';

/** One player's progress through one Puzzle Number. */
export interface Progress {
  puzzleNumber: number;
  /** Guess Vocabulary names, in the order guessed. */
  guesses: string[];
}

/** A Play Token: base64url JSON progress, a dot, then its base64url HMAC-SHA256. */
export function signPlayToken(progress: Progress, signingKey: string): string {
  const payload = Buffer.from(JSON.stringify(progress)).toString('base64url');
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
