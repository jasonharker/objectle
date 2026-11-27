// The placeholder content bundle is what the deployed walking skeleton serves
// until the curation build ships a real one (ADR-0004). It must load, and keep
// a Daily Object with six Reveal Stages scheduled for a year from the Launch
// Date, so the deployed game does not stop on day 4 as the 3-day test fixture
// would.
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { loadContent } from '../src/app.ts';

const placeholderDir = fileURLToPath(new URL('../../../content/placeholder/', import.meta.url));
/** The Launch Date the deployment is configured with while it serves the placeholder. */
const launchDate = '2026-11-25';

test('schedules a Daily Object for every Puzzle Number of the first year', async () => {
  const content = await loadContent(placeholderDir, { launchDate });
  for (let puzzleNumber = 1; puzzleNumber <= 365; puzzleNumber++) {
    const stages = content.revealStages(puzzleNumber);
    expect(stages, `Puzzle Number ${puzzleNumber}`).toHaveLength(6);
    for (const assets of stages!) expect(assets.length, `Puzzle Number ${puzzleNumber}`).toBeGreaterThan(0);
  }
});

test('has enough Guess Vocabulary to play every Daily Object through all six Reveal Stages', async () => {
  const content = await loadContent(placeholderDir, { launchDate });
  // Five wrong Guesses reach Reveal Stage 6; the sixth Guess can be the Daily Object.
  expect(content.bundle.guessVocabulary.length).toBeGreaterThanOrEqual(6);
});
