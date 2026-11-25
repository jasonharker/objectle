const DAY_MS = 24 * 60 * 60 * 1000;

// en-CA formats dates as YYYY-MM-DD.
const pacificDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The active Puzzle Number at `now`: 1 on the Launch Date (a YYYY-MM-DD
 * Pacific date), turning over at midnight Pacific whatever the DST offset.
 */
export function puzzleNumberAt(now: Date, launchDate: string): number {
  const today = Date.parse(pacificDate.format(now));
  return Math.round((today - Date.parse(launchDate)) / DAY_MS) + 1;
}
