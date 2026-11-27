// A Guess as one row of the guess list: its name, then one cell per Attribute
// of its Feedback, or a solved marker for the correct Guess.
import type { Feedback } from '@objectle/shared';

/** One Attribute's cell: a short visible label, a glyph, and the full text a screen reader reads. */
export interface Cell {
  label: string;
  glyph: string;
  matched: boolean;
  text: string;
}

/** The column headings, in cell order. */
export const attributeLabels = ['Category', 'Size', 'Natural/made', 'Material'];

// Size describes the Daily Object relative to the Guess; similar is styled as a match.
const sizeCell: Record<Feedback['size'], Pick<Cell, 'glyph' | 'matched' | 'text'>> = {
  bigger: { glyph: '↑', matched: false, text: 'Size: the Daily Object is bigger' },
  smaller: { glyph: '↓', matched: false, text: 'Size: the Daily Object is smaller' },
  similar: { glyph: '≈', matched: true, text: 'Size: similar' },
};

function matchCell(label: string, name: string, match: Feedback['category']): Cell {
  const matched = match === 'match';
  return { label, glyph: matched ? '✓' : '✗', matched, text: `${name}: ${match}` };
}

/** The four cells for a wrong Guess's Feedback: Category, Size, Natural vs. made, Primary Material. */
export function feedbackCells({ category, size, naturalOrMade, primaryMaterial }: Feedback): Cell[] {
  return [
    matchCell(attributeLabels[0], 'Category', category),
    { label: attributeLabels[1], ...sizeCell[size] },
    matchCell(attributeLabels[2], 'Natural vs. made', naturalOrMade),
    matchCell(attributeLabels[3], 'Primary Material', primaryMaterial),
  ];
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/** The headings row: hidden from screen readers, whose cells carry the full text. */
export function guessHeadingRow(): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'guess-headings';
  item.setAttribute('aria-hidden', 'true');
  item.append(
    // No-break spaces keep each glyph with its word if the legend wraps.
    span('guess-legend', 'Size: Daily Object ↑ bigger · ↓ smaller · ≈ similar'),
    span('guess-name', 'Guess'),
    ...attributeLabels.map((label) => span('guess-heading', label)),
  );
  return item;
}

/** A Guess's row: its Feedback cells when wrong, a solved marker when the Guess has none. */
export function guessRow(name: string, feedback: Feedback | undefined): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'guess-row';
  const nameCell = span('guess-name', name);
  nameCell.title = name;
  item.append(nameCell);
  if (feedback === undefined) {
    const solved = span('guess-cell guess-match guess-solved', '');
    solved.append(glyph('✓'), span('guess-sr-only', ', '), 'Solved');
    item.append(solved);
    return item;
  }
  for (const cell of feedbackCells(feedback)) {
    const element = span(cell.matched ? 'guess-cell guess-match' : 'guess-cell', '');
    // The comma keeps a screen reader from running the name and each Attribute together.
    element.append(glyph(cell.glyph), span('guess-sr-only', `, ${cell.text}`));
    item.append(element);
  }
  return item;
}

function glyph(text: string): HTMLSpanElement {
  const element = span('guess-glyph', text);
  element.setAttribute('aria-hidden', 'true');
  return element;
}
