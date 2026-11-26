import type { Feedback, GuessVocabularyEntry, Match } from '@objectle/shared';

const match = (a: string, b: string): Match => (a === b ? 'match' : 'no match');

/**
 * A Size in whole micrometres, so the 1.25 threshold compares exactly for
 * Sizes curated as decimal metres (0.09 and 0.1125 are similar; in floating
 * point 0.09 * 1.25 is less than 0.1125).
 */
const micrometres = (metres: number) => Math.round(metres * 1e6);

/** Feedback on a wrong Guess: a pure function of its and the Daily Object's Attributes. */
export function feedback(guess: GuessVocabularyEntry, dailyObject: GuessVocabularyEntry): Feedback {
  const daily = micrometres(dailyObject.size);
  const guessed = micrometres(guess.size);
  return {
    category: match(guess.category, dailyObject.category),
    size: 4 * daily > 5 * guessed ? 'bigger' : 4 * guessed > 5 * daily ? 'smaller' : 'similar',
    naturalOrMade: match(guess.naturalOrMade, dailyObject.naturalOrMade),
    primaryMaterial: match(guess.primaryMaterial, dailyObject.primaryMaterial),
  };
}
