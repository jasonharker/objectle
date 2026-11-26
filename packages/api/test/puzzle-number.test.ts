import { describe, expect, test } from 'vitest';
import { puzzleNumberAt, startGame } from './harness.ts';

describe('Puzzle Number', () => {
  test('is 1 on the Launch Date', async () => {
    expect(await puzzleNumberAt('2027-03-01T20:00:00Z', '2027-03-01')).toBe(1);
  });

  test('counts up by one per Pacific day', async () => {
    expect(await puzzleNumberAt('2027-03-02T20:00:00Z', '2027-03-01')).toBe(2);
    expect(await puzzleNumberAt('2027-03-03T20:00:00Z', '2027-03-01')).toBe(3);
  });

  test('rolls over at midnight Pacific, not midnight UTC', async () => {
    // 2027-03-01 is in PST (UTC-8): the Pacific day ends at 08:00 UTC on 03-02.
    expect(await puzzleNumberAt('2027-03-02T00:00:00Z', '2027-03-01')).toBe(1);
    expect(await puzzleNumberAt('2027-03-02T07:59:59Z', '2027-03-01')).toBe(1);
    expect(await puzzleNumberAt('2027-03-02T08:00:00Z', '2027-03-01')).toBe(2);
  });

  test('rolls over at midnight Pacific across the spring-forward day', async () => {
    // 2027-03-14 starts in PST (UTC-8) and ends in PDT (UTC-7): a 23-hour day.
    expect(await puzzleNumberAt('2027-03-14T07:59:59Z', '2027-03-13')).toBe(1);
    expect(await puzzleNumberAt('2027-03-14T08:00:00Z', '2027-03-13')).toBe(2);
    expect(await puzzleNumberAt('2027-03-15T06:59:59Z', '2027-03-13')).toBe(2);
    expect(await puzzleNumberAt('2027-03-15T07:00:00Z', '2027-03-13')).toBe(3);
  });

  test('rolls over at midnight Pacific across the fall-back day', async () => {
    // 2027-11-07 starts in PDT (UTC-7) and ends in PST (UTC-8): a 25-hour day.
    expect(await puzzleNumberAt('2027-11-07T06:59:59Z', '2027-11-06')).toBe(1);
    expect(await puzzleNumberAt('2027-11-07T07:00:00Z', '2027-11-06')).toBe(2);
    expect(await puzzleNumberAt('2027-11-08T07:59:59Z', '2027-11-06')).toBe(2);
    expect(await puzzleNumberAt('2027-11-08T08:00:00Z', '2027-11-06')).toBe(3);
  });
});

describe('Starting a game', () => {
  test('before the Launch Date there is no active Puzzle Number', async () => {
    const { response } = await startGame({ now: '2027-03-01T07:59:59Z', launchDate: '2027-03-01' });
    expect(response.statusCode).toBe(404);
  });

  test('fails when the Schedule has no Daily Object for the active Puzzle Number', async () => {
    // The fixture Schedule covers Puzzle Numbers 1-3.
    const { response } = await startGame({ now: '2027-03-04T20:00:00Z', launchDate: '2027-03-01' });
    expect(response.statusCode).toBe(503);
  });
});
