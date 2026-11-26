// The Result counter stores behind the API's resultCounters dependency. The
// Postgres store runs only against a real, throwaway database named by
// OBJECTLE_TEST_DATABASE_URL; its table is dropped before each test.
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { memoryResultCounters, type ResultCounters } from '../src/app.ts';
import { postgresResultCounters } from '../src/postgres-result-counters.ts';

const databaseUrl = process.env.OBJECTLE_TEST_DATABASE_URL;

const empty = { solved: [0, 0, 0, 0, 0, 0], failed: 0 };

function contract(name: string, open: () => Promise<ResultCounters>) {
  describe(name, () => {
    test('a Puzzle Number nobody has finished has an empty Distribution', async () => {
      expect(await (await open()).distribution(1)).toEqual(empty);
    });

    test('counts each Result per Puzzle Number', async () => {
      const counters = await open();
      await counters.increment(1, { solved: true, revealStage: 1 });
      await counters.increment(1, { solved: true, revealStage: 6 });
      await counters.increment(1, { solved: true, revealStage: 6 });
      await counters.increment(1, { solved: false });
      await counters.increment(2, { solved: true, revealStage: 3 });
      expect(await counters.distribution(1)).toEqual({ solved: [1, 0, 0, 0, 0, 2], failed: 1 });
      expect(await counters.distribution(2)).toEqual({ solved: [0, 0, 1, 0, 0, 0], failed: 0 });
      expect(await counters.distribution(3)).toEqual(empty);
    });

    test('an increment returns the Puzzle Number’s Distribution counting that game', async () => {
      const counters = await open();
      await counters.increment(1, { solved: true, revealStage: 2 });
      await counters.increment(2, { solved: false });
      expect(await counters.increment(1, { solved: true, revealStage: 2 })).toEqual({
        solved: [0, 2, 0, 0, 0, 0],
        failed: 0,
      });
      expect(await counters.increment(1, { solved: false })).toEqual({ solved: [0, 2, 0, 0, 0, 0], failed: 1 });
    });

    test('loses no count to concurrent increments', async () => {
      const counters = await open();
      await Promise.all(Array.from({ length: 50 }, () => counters.increment(7, { solved: false })));
      expect((await counters.distribution(7)).failed).toBe(50);
    });
  });
}

contract('In-memory Result counters', async () => memoryResultCounters());

describe.skipIf(!databaseUrl)('Postgres Result counters', () => {
  const opened: { close(): Promise<void> }[] = [];
  const open = async () => {
    const counters = await postgresResultCounters(databaseUrl!);
    opened.push(counters);
    return counters;
  };

  beforeEach(async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('DROP TABLE IF EXISTS result_counters');
    await client.end();
  });
  afterAll(async () => {
    await Promise.allSettled(opened.map((counters) => counters.close()));
  });

  contract('the store', open);

  test('keeps its counts across a restart, and several replicas can start at once', async () => {
    const [first, second] = await Promise.all([open(), open()]);
    await first.increment(1, { solved: true, revealStage: 2 });
    await second.increment(1, { solved: true, revealStage: 2 });
    await first.close();
    const restarted = await open();
    expect((await restarted.distribution(1)).solved[1]).toBe(2);
  });
});
