// The mapping from a wrong Guess's Feedback to its row's cells: what each
// Attribute shows, and what a screen reader reads for it.
import { expect, test } from 'vitest';
import { feedbackCells } from '../src/guess-row.ts';

test('maps each Attribute to a labelled cell with its full text', () => {
  expect(
    feedbackCells({ category: 'no match', size: 'bigger', naturalOrMade: 'match', primaryMaterial: 'no match' }),
  ).toEqual([
    { label: 'Category', glyph: '✗', matched: false, text: 'Category: no match' },
    { label: 'Size', glyph: '↑', matched: false, text: 'Size: the Daily Object is bigger' },
    { label: 'Natural/made', glyph: '✓', matched: true, text: 'Natural vs. made: match' },
    { label: 'Material', glyph: '✗', matched: false, text: 'Primary Material: no match' },
  ]);
});

test('points Size at the Daily Object, and styles similar as a match', () => {
  const size = (value: 'bigger' | 'smaller' | 'similar') =>
    feedbackCells({ category: 'match', size: value, naturalOrMade: 'match', primaryMaterial: 'match' })[1];
  expect(size('smaller')).toMatchObject({ glyph: '↓', matched: false, text: 'Size: the Daily Object is smaller' });
  expect(size('similar')).toMatchObject({ glyph: '≈', matched: true, text: 'Size: similar' });
});
