import { createHmac, timingSafeEqual } from 'node:crypto';

/** One player's progress through one Puzzle Number. */
export interface Progress {
  puzzleNumber: number;
  /** Guess Vocabulary names, in the order guessed. */
  guesses: string[];
}

/** A Play Token: base64url JSON progress, a dot, then its base64url HMAC-SHA256. */
export function signPlayToken(progress: Progress, signingKey: string): string {
  const payload = Buffer.from(JSON.stringify(progress)).toString('base64url');
  return `${payload}.${sign(payload, signingKey)}`;
}

/** The progress a Play Token records, or undefined if it is malformed or not signed with the signing key. */
export function verifyPlayToken(token: unknown, signingKey: string): Progress | undefined {
  if (typeof token !== 'string') return undefined;
  const [payload, signature, ...rest] = token.split('.');
  if (signature === undefined || rest.length > 0) return undefined;
  const expected = Buffer.from(sign(payload, signingKey));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  const progress = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return { puzzleNumber: progress.puzzleNumber, guesses: progress.guesses };
}

function sign(payload: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}
