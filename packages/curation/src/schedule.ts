// Schedule generation around Pins, by the policy of ADR-0007. Terms follow
// GLOSSARY.md.
import { createHash } from 'node:crypto';
import type { DifficultyRating, ScheduleEntry } from '@objectle/shared';

/** How many Puzzle Numbers past the active one each build assigns. */
export const planningHorizon = 90;
/** The fewest Puzzle Numbers between two appearances of an object; Pins are exempt. */
export const repeatGap = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The Difficulty Rating each Pacific weekday aims for, Sunday first. */
const difficultyPattern: DifficultyRating[] = ['medium', 'easy', 'easy', 'medium', 'medium', 'hard', 'hard'];
/** The ratings a day tries, in order, by the rating it aims for. */
const fallbacks: Record<DifficultyRating, DifficultyRating[]> = {
  easy: ['easy', 'medium', 'hard'],
  medium: ['medium', 'easy', 'hard'],
  hard: ['hard', 'medium', 'easy'],
};

/** A YYYY-MM-DD date that exists, as a count of days since 1970-01-01; undefined if it is not one. */
export function dayOf(date: unknown): number | undefined {
  const match = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  // Date rolls 02-30 over to 03-02, so a date that does not exist fails the round trip.
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return undefined;
  }
  return time / DAY_MS;
}

const pacificDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Pacific date at an instant, YYYY-MM-DD: the day turns over at midnight Pacific. */
export function pacificDateAt(now: Date): string {
  const parts = pacificDate.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export interface Plan {
  /** Every Answer Pool object, with its Difficulty Rating. */
  answerPool: Map<string, DifficultyRating>;
  /** Pinned nouns by Puzzle Number, all after the active one. */
  pins: Map<number, string>;
  /** The previously published Schedule. */
  previous: ScheduleEntry[];
  /** The active Puzzle Number; 0 or less before launch. */
  active: number;
  /** Day number (see dayOf) of the Launch Date, for the weekday of each Puzzle Number. */
  launchDay: number;
  /** Mixed into the tie-breaking shuffle. */
  seed: string;
}

/**
 * Extend the previously published Schedule through the Planning Horizon.
 * Past and active Puzzle Numbers are kept as published. A future one keeps
 * its object unless a Pin took its date, its object left the Answer Pool, it
 * was a Pin that has since been removed, or a Pin put it inside its object's
 * Repeat Gap; the rest are filled until no object is eligible. Returns the
 * Schedule, by Puzzle Number, and the notices the build reports.
 */
export function planSchedule({ answerPool, pins, previous, active, launchDay, seed }: Plan): {
  schedule: ScheduleEntry[];
  notices: string[];
} {
  const assigned = new Map<number, ScheduleEntry>();
  for (const entry of previous) {
    const { puzzleNumber, noun, pinned } = entry;
    const insidePinGap = [...pins].some(([pin, pinNoun]) => pinNoun === noun && Math.abs(pin - puzzleNumber) < repeatGap);
    if (puzzleNumber <= active || (!pinned && answerPool.has(noun) && !insidePinGap)) assigned.set(puzzleNumber, entry);
  }
  for (const [puzzleNumber, noun] of pins) assigned.set(puzzleNumber, { puzzleNumber, noun, pinned: true });

  /** Every Puzzle Number each noun is assigned to. */
  const appearances = new Map<string, number[]>();
  const appear = (noun: string, puzzleNumber: number) => {
    if (!appearances.has(noun)) appearances.set(noun, []);
    appearances.get(noun)!.push(puzzleNumber);
  };
  for (const { noun, puzzleNumber } of assigned.values()) appear(noun, puzzleNumber);

  const notices: string[] = [];
  const first = Math.max(active, 1);
  const horizon = first + planningHorizon;
  for (let puzzleNumber = first; puzzleNumber <= horizon; puzzleNumber++) {
    if (assigned.has(puzzleNumber)) continue;
    const weekday = new Date((launchDay + puzzleNumber - 1) * DAY_MS).getUTCDay();
    const aim = difficultyPattern[weekday];
    const lastBefore = (noun: string) =>
      Math.max(-Infinity, ...(appearances.get(noun) ?? []).filter((p) => p < puzzleNumber));
    const shuffleKey = (noun: string) =>
      createHash('sha256').update(JSON.stringify([seed, puzzleNumber, noun])).digest('hex');

    let choice: { noun: string; rating: DifficultyRating } | undefined;
    for (const rating of fallbacks[aim]) {
      const eligible = [...answerPool]
        .filter(([, objectRating]) => objectRating === rating)
        .map(([noun]) => noun)
        .filter((noun) => (appearances.get(noun) ?? []).every((p) => Math.abs(p - puzzleNumber) >= repeatGap));
      if (eligible.length === 0) continue;
      const keys = new Map(eligible.map((noun) => [noun, shuffleKey(noun)]));
      eligible.sort((a, b) => lastBefore(a) - lastBefore(b) || (keys.get(a)! < keys.get(b)! ? -1 : 1));
      choice = { noun: eligible[0], rating };
      break;
    }

    if (!choice) {
      let short = 0;
      for (let p = puzzleNumber; p <= horizon; p++) if (!assigned.has(p)) short++;
      notices.push(
        `Schedule shortfall: no Answer Pool object is eligible for Puzzle Number ${puzzleNumber}, so the Schedule is ` +
          `assigned through Puzzle Number ${puzzleNumber - 1}, ${short} days short of the Planning Horizon ` +
          `(Puzzle Number ${horizon})`,
      );
      break;
    }
    if (choice.rating !== aim) {
      notices.push(
        `Difficulty Pattern substitution: Puzzle Number ${puzzleNumber} (${weekdays[weekday]}) aims for ${aim} ` +
          `but takes ${choice.rating}`,
      );
    }
    assigned.set(puzzleNumber, { puzzleNumber, noun: choice.noun, pinned: false });
    appear(choice.noun, puzzleNumber);
  }

  return { schedule: [...assigned.values()].sort((a, b) => a.puzzleNumber - b.puzzleNumber), notices };
}
