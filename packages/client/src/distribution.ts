import type { Distribution, Result } from '@objectle/shared';

/** One row of the end-of-game Distribution chart. */
export interface DistributionRow {
  /** Short visible label, e.g. "Stage 3". */
  label: string;
  /** Full screen-reader text, e.g. "Solved at Reveal Stage 3: 12 players, your Result". */
  accessibleLabel: string;
  count: number;
  /** The count over the largest count, 0-1; 0 for every row when all counts are 0. */
  share: number;
  /** Whether this row is the player's own Result. */
  isPlayer: boolean;
}

/** The chart's rows: one per Reveal Stage, then "Not solved". */
export function distributionRows(distribution: Distribution, result: Result | null): DistributionRow[] {
  const rows = [
    ...distribution.solved.map((count, index) => ({
      label: `Stage ${index + 1}`,
      full: `Solved at Reveal Stage ${index + 1}`,
      count,
      isPlayer: result?.solved === true && result.revealStage === index + 1,
    })),
    { label: 'Not solved', full: 'Not solved', count: distribution.failed, isPlayer: result?.solved === false },
  ];
  const max = Math.max(...rows.map(({ count }) => count));
  return rows.map(({ label, full, count, isPlayer }) => ({
    label,
    accessibleLabel: `${full}: ${count} ${count === 1 ? 'player' : 'players'}${isPlayer ? ', your Result' : ''}`,
    count,
    share: max === 0 ? 0 : count / max,
    isPlayer,
  }));
}
