import { describe, expect, test } from 'vitest';
import type { GameResponse } from '@objectle/shared';
import { startGame } from './harness.ts';

const now = '2027-03-01T20:00:00Z';

async function playTokenWith(signingKey: string) {
  const { response } = await startGame({ now, signingKey });
  return response.json<GameResponse>().playToken;
}

describe('Play Token', () => {
  test('a new game carries a Play Token signed with the signing key', async () => {
    const tokenA = await playTokenWith('signing-key-a-signing-key-a-signing-key-a');
    const tokenB = await playTokenWith('signing-key-b-signing-key-b-signing-key-b');
    expect(tokenA).toMatch(/\S{20,}/);
    expect(tokenA).not.toBe(tokenB);
  });
});
