import { describe, expect, it } from 'vitest';
import { distributionRows } from '../src/distribution.ts';

const distribution = { solved: [0, 2, 8, 4, 0, 1], failed: 3 };

describe('distributionRows', () => {
  it('gives one row per Reveal Stage, then Not solved, scaled to the largest count', () => {
    const rows = distributionRows(distribution, { solved: true, revealStage: 3 });
    expect(rows.map(({ label }) => label)).toEqual(['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Stage 6', 'Not solved']);
    expect(rows.map(({ share }) => share)).toEqual([0, 0.25, 1, 0.5, 0, 0.125, 0.375]);
  });

  it('keeps zero rows with a zero count', () => {
    const [first] = distributionRows(distribution, null);
    expect(first).toEqual({
      label: 'Stage 1',
      accessibleLabel: 'Solved at Reveal Stage 1: 0 players',
      count: 0,
      share: 0,
      isPlayer: false,
    });
  });

  it('does not divide by zero when every count is 0', () => {
    const rows = distributionRows({ solved: [0, 0, 0, 0, 0, 0], failed: 0 }, null);
    expect(rows).toHaveLength(7);
    expect(rows.every(({ share }) => share === 0)).toBe(true);
  });

  it('marks the Reveal Stage the player solved at', () => {
    const rows = distributionRows(distribution, { solved: true, revealStage: 6 });
    expect(rows.filter(({ isPlayer }) => isPlayer).map(({ label }) => label)).toEqual(['Stage 6']);
    expect(rows[5]!.accessibleLabel).toBe('Solved at Reveal Stage 6: 1 player, your Result');
  });

  it('marks Not solved when the player did not solve it', () => {
    const rows = distributionRows(distribution, { solved: false });
    expect(rows.filter(({ isPlayer }) => isPlayer).map(({ label }) => label)).toEqual(['Not solved']);
    expect(rows[6]!.accessibleLabel).toBe('Not solved: 3 players, your Result');
  });
});
