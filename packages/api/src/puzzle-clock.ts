const DAY_MS = 24 * 60 * 60 * 1000;

const pacificDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** Midnight UTC of the Pacific calendar date at `now`, as epoch milliseconds. */
function pacificDay(now: Date): number {
  const parts = pacificDate.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

/** Midnight UTC of a YYYY-MM-DD date, as epoch milliseconds. */
function calendarDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * The active Puzzle Number at `now`: 1 on the Launch Date (a YYYY-MM-DD
 * Pacific date), turning over at midnight Pacific whatever the DST offset.
 */
export function puzzleNumberAt(now: Date, launchDate: string): number {
  return Math.round((pacificDay(now) - calendarDay(launchDate)) / DAY_MS) + 1;
}
