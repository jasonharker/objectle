import pg from 'pg';
import type { Result } from '@objectle/shared';
import type { ResultCounters } from './result-counters.ts';

// One row per (Puzzle Number, Result) that someone has finished with. Result
// is 'solved-1' … 'solved-6' or 'failed'. The advisory lock makes replicas
// starting at once create the table one at a time; a multi-statement query
// runs as one transaction, which releases it.
const createTable = `
  SELECT pg_advisory_xact_lock(hashtext('objectle.result_counters'));
  CREATE TABLE IF NOT EXISTS result_counters (
    puzzle_number integer NOT NULL,
    result text NOT NULL CHECK (result IN ('solved-1', 'solved-2', 'solved-3', 'solved-4', 'solved-5', 'solved-6', 'failed')),
    count bigint NOT NULL,
    PRIMARY KEY (puzzle_number, result)
  )`;

const resultKey = (result: Result) => (result.solved ? `solved-${result.revealStage}` : 'failed');

/** Result counters in Postgres, shared by every replica; creates its table if it is missing. */
export async function postgresResultCounters(connectionString: string): Promise<ResultCounters & { close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString });
  // An idle connection dropped by the server would otherwise crash the API;
  // the next query reconnects, and a request that fails meanwhile gets a 500.
  pool.on('error', (error) => console.error('Result counters: idle Postgres connection failed:', error.message));
  try {
    await pool.query(createTable);
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    async increment(puzzleNumber, result) {
      await pool.query(
        `INSERT INTO result_counters (puzzle_number, result, count) VALUES ($1, $2, 1)
         ON CONFLICT (puzzle_number, result) DO UPDATE SET count = result_counters.count + 1`,
        [puzzleNumber, resultKey(result)],
      );
    },
    async distribution(puzzleNumber) {
      const { rows } = await pool.query<{ result: string; count: string }>(
        'SELECT result, count FROM result_counters WHERE puzzle_number = $1',
        [puzzleNumber],
      );
      const counts = new Map(rows.map(({ result, count }) => [result, Number(count)]));
      return {
        solved: [1, 2, 3, 4, 5, 6].map((stage) => counts.get(`solved-${stage}`) ?? 0),
        failed: counts.get('failed') ?? 0,
      };
    },
    close: () => pool.end(),
  };
}
