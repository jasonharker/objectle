// The Schedule-remaining gauge (ADR-0008), served on the metrics listener
// only, and recomputed from the clock on every scrape.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ContentBundle } from '@objectle/shared';
import { copyFixture, startApi, startMetrics } from './harness.ts';

const gauge = /^objectle_schedule_remaining_puzzle_numbers (-?\d+)$/m;

/** The fixture bundle with a Schedule through Puzzle Number 10. */
async function tenDaySchedule(): Promise<string> {
  const dir = await copyFixture();
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
  bundle.schedule = Array.from({ length: 10 }, (_, i) => ({
    puzzleNumber: i + 1,
    noun: i % 2 === 0 ? 'teapot' : 'pinecone',
    pinned: false,
  }));
  await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle));
  return dir;
}
const contentDir = await tenDaySchedule();

async function scrape(metrics: Awaited<ReturnType<typeof startMetrics>>): Promise<number> {
  const response = await metrics.inject({ method: 'GET', url: '/metrics' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
  expect(response.body).toContain('# TYPE objectle_schedule_remaining_puzzle_numbers gauge');
  return Number(gauge.exec(response.body)![1]);
}

test('before launch, counts the Schedule from Puzzle Number 1', async () => {
  expect(await scrape(await startMetrics({ now: '2027-02-20T12:00:00-08:00', contentDir }))).toBe(9);
});

test('mid-Schedule, counts the Puzzle Numbers scheduled past the active one', async () => {
  expect(await scrape(await startMetrics({ now: '2027-03-04T12:00:00-08:00', contentDir }))).toBe(6);
});

test('falls by one a day later, without reloading the content', async () => {
  let now = '2027-03-04T23:59:00-08:00';
  const metrics = await startMetrics({ now: () => now, contentDir });
  expect(await scrape(metrics)).toBe(6);
  now = '2027-03-05T00:01:00-08:00';
  expect(await scrape(metrics)).toBe(5);
});

test('is zero on the last scheduled Puzzle Number and negative once the Schedule has run out', async () => {
  expect(await scrape(await startMetrics({ now: '2027-03-10T12:00:00-08:00', contentDir }))).toBe(0);
  expect(await scrape(await startMetrics({ now: '2027-03-12T12:00:00-08:00', contentDir }))).toBe(-2);
});

test('counts only the unbroken run of scheduled Puzzle Numbers past the active one, not a later Pin past a hole', async () => {
  const dir = await copyFixture();
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
  bundle.schedule = [...Array.from({ length: 30 }, (_, i) => i + 1), 95].map((puzzleNumber) => ({
    puzzleNumber,
    noun: puzzleNumber % 2 === 0 ? 'pinecone' : 'teapot',
    pinned: puzzleNumber === 95,
  }));
  await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle));
  expect(await scrape(await startMetrics({ now: '2027-03-10T12:00:00-08:00', contentDir: dir }))).toBe(20);
  // Active on 30, the end of the run: the hole at Puzzle Number 31 leaves none.
  expect(await scrape(await startMetrics({ now: '2027-03-30T12:00:00-08:00', contentDir: dir }))).toBe(0);
});

test('is not served on the public listener', async () => {
  const api = await startApi({ now: '2027-03-04T12:00:00-08:00', contentDir });
  const response = await api.inject({ method: 'GET', url: '/metrics' });
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain('objectle_schedule_remaining');
});
