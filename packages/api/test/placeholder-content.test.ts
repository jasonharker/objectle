// The placeholder content bundle is what the deployed walking skeleton serves
// until the curation build ships a real one (ADR-0004). It must load, and keep
// a Daily Object scheduled for a year from the Launch Date, so the deployed
// game does not stop on day 4 as the 3-day test fixture would.
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { loadContent } from '../src/app.ts';

const placeholderDir = fileURLToPath(new URL('../../../content/placeholder/', import.meta.url));

test('schedules a Daily Object for every Puzzle Number of the first year', async () => {
  const content = await loadContent(placeholderDir);
  for (let puzzleNumber = 1; puzzleNumber <= 365; puzzleNumber++) {
    expect(content.revealStages(puzzleNumber)?.[0]?.length, `Puzzle Number ${puzzleNumber}`).toBeGreaterThan(0);
  }
});
