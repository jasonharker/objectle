import type { Distribution, Result } from '@objectle/shared';

/**
 * The anonymous Result counters: one count per (Puzzle Number, Result). They
 * are the only server-side state (ADR-0001), shared by every API replica.
 */
export interface ResultCounters {
  /**
   * Count one more game finished on a Puzzle Number with a Result, returning
   * that Puzzle Number's counts including it. One step, so no failure between
   * counting and reading can make a retried finishing Guess count twice.
   */
  increment(puzzleNumber: number, result: Result): Promise<Distribution>;
  /** The counts for one Puzzle Number. */
  distribution(puzzleNumber: number): Promise<Distribution>;
}

/** Counters held in this process only: for tests, never for a deployment with more than one replica. */
export function memoryResultCounters(): ResultCounters {
  const counts = new Map<number, Distribution>();
  const of = (puzzleNumber: number) => {
    if (!counts.has(puzzleNumber)) counts.set(puzzleNumber, { solved: [0, 0, 0, 0, 0, 0], failed: 0 });
    return counts.get(puzzleNumber)!;
  };
  const copyOf = (puzzleNumber: number): Distribution => {
    const { solved, failed } = of(puzzleNumber);
    return { solved: [...solved], failed };
  };
  return {
    async increment(puzzleNumber, result) {
      const distribution = of(puzzleNumber);
      if (result.solved) distribution.solved[result.revealStage - 1]++;
      else distribution.failed++;
      return copyOf(puzzleNumber);
    },
    distribution: async (puzzleNumber) => copyOf(puzzleNumber),
  };
}
